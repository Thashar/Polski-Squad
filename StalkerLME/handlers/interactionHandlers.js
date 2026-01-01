const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const messages = require('../config/messages');
const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;

const logger = createBotLogger('StalkerLME');

const confirmationData = new Map();

// Throttling dla guild.members.fetch() - zapobiega rate limitom Discord Gateway (opcode 8)
const membersFetchThrottle = new Map(); // guildId -> { lastFetch: timestamp, isInProgress: boolean }
const MEMBERS_FETCH_COOLDOWN = 30000; // 30 sekund między fetch dla tego samego guild

/**
 * Bezpieczne pobranie członków serwera z throttlingiem
 * @param {Guild} guild - Serwer Discord
 * @param {boolean} force - Wymuś fetch nawet jeśli w cooldown
 * @returns {Promise<Collection>} - Kolekcja członków
 */
async function safeFetchMembers(guild, force = false) {
    const guildId = guild.id;
    const now = Date.now();
    const throttleData = membersFetchThrottle.get(guildId);

    // Jeśli fetch już jest w toku, poczekaj i użyj cache
    if (throttleData && throttleData.isInProgress) {
        logger.warn(`[🔒 THROTTLE] Fetch już w toku dla guild ${guild.name}, używam cache`);
        return guild.members.cache;
    }

    // Jeśli ostatni fetch był niedawno i nie wymuszamy, użyj cache
    if (!force && throttleData && (now - throttleData.lastFetch) < MEMBERS_FETCH_COOLDOWN) {
        const secondsLeft = Math.ceil((MEMBERS_FETCH_COOLDOWN - (now - throttleData.lastFetch)) / 1000);
        logger.info(`[🔒 THROTTLE] Pomijam fetch dla guild ${guild.name} (cooldown: ${secondsLeft}s), używam cache (${guild.members.cache.size} członków)`);
        return guild.members.cache;
    }

    // Wykonaj fetch
    try {
        logger.info(`🔄 Pobieram członków guild ${guild.name}...`);
        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: true });
        
        const members = await guild.members.fetch();
        
        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: false });
        logger.info(`✅ Pobrano ${members.size} członków dla guild ${guild.name}`);
        
        return members;
    } catch (error) {
        membersFetchThrottle.set(guildId, { lastFetch: now, isInProgress: false });
        logger.error(`❌ Błąd pobierania członków guild ${guild.name}:`, error);
        // Fallback do cache
        return guild.members.cache;
    }
}

async function handleInteraction(interaction, sharedState, config) {
    const { client, databaseService, ocrService, punishmentService, reminderService, survivorService, phaseService } = sharedState;

    try {
        if (interaction.isCommand()) {
            await handleSlashCommand(interaction, sharedState);
        } else if (interaction.isAutocomplete()) {
            await handleAutocomplete(interaction, sharedState);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenu(interaction, config, reminderService, sharedState);
        } else if (interaction.isButton()) {
            await handleButton(interaction, sharedState);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction, sharedState);
        }
    } catch (error) {
        logger.error('[INTERACTION] ❌ Błąd obsługi interakcji');
        logger.error(`[INTERACTION] ❌ Error type: ${typeof error}`);
        logger.error(`[INTERACTION] ❌ Error is null/undefined: ${error === null || error === undefined}`);

        if (error) {
            logger.error(`[INTERACTION] ❌ Error name: ${error?.name}`);
            logger.error(`[INTERACTION] ❌ Error message: ${error?.message}`);
            logger.error(`[INTERACTION] ❌ Error code: ${error?.code}`);
            logger.error(`[INTERACTION] ❌ HTTP status: ${error?.status}`);
            logger.error(`[INTERACTION] ❌ Stack trace: ${error?.stack}`);

            // Próbuj serializować error z bezpieczną metodą
            try {
                const errorDetails = {
                    name: error?.name,
                    message: error?.message,
                    code: error?.code,
                    status: error?.status,
                    method: error?.method,
                    url: error?.url
                };
                logger.error(`[INTERACTION] ❌ Error details: ${JSON.stringify(errorDetails, null, 2)}`);
            } catch (serializeError) {
                logger.error(`[INTERACTION] ❌ Nie można serializować błędu: ${serializeError.message}`);
            }
        } else {
            logger.error('[INTERACTION] ❌ Error is null or undefined - this should not happen!');
        }

        // Próbuj odpowiedzieć na interakcję (może być już timeout)
        try {
            const errorEmbed = new EmbedBuilder()
                .setTitle('❌ Wystąpił błąd')
                .setDescription(messages.errors.unknownError)
                .setColor('#FF0000')
                .setTimestamp();

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
            }
        } catch (replyError) {
            // Interakcja prawdopodobnie wygasła (timeout)
            logger.error('[INTERACTION] ⚠️ Nie można odpowiedzieć na interakcję (timeout?):', replyError.message);
        }
    }
}

async function handleSlashCommand(interaction, sharedState) {
    const { config, databaseService, ocrService, punishmentService, reminderService, reminderUsageService, survivorService, phaseService } = sharedState;

    // Sprawdź uprawnienia dla wszystkich komend oprócz /decode, /wyniki, /progres, /player-status, /clan-status i /clan-progres
    const publicCommands = ['decode', 'wyniki', 'progres', 'player-status', 'clan-status', 'clan-progres'];
    if (!publicCommands.includes(interaction.commandName) && !hasPermission(interaction.member, config.allowedPunishRoles)) {
        await interaction.reply({ content: messages.errors.noPermission, flags: MessageFlags.Ephemeral });
        return;
    }

    // Sprawdź kanał dla komend OCR i faz
    const ocrCommands = ['punish', 'remind', 'faza1', 'faza2'];
    const allowedChannelId = '1437122516974829679';
    if (ocrCommands.includes(interaction.commandName) && interaction.channelId !== allowedChannelId) {
        await interaction.reply({
            content: `❌ Ta komenda może być użyta tylko na kanale <#${allowedChannelId}>`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    switch (interaction.commandName) {
        case 'punish':
            await handlePunishCommand(interaction, config, ocrService, punishmentService);
            break;
        case 'remind':
            await handleRemindCommand(interaction, config, ocrService, reminderService, reminderUsageService);
            break;
        case 'punishment':
            await handlePunishmentCommand(interaction, config, databaseService, punishmentService);
            break;
        case 'points':
            await handlePointsCommand(interaction, config, databaseService, punishmentService);
            break;
        case 'debug-roles':
            // Wymagane uprawnienia moderatora lub administratora
            if (!interaction.member.permissions.has('ModerateMembers') && !interaction.member.permissions.has('Administrator')) {
                await interaction.reply({
                    content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Moderator** lub **Administrator**',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
            await handleDebugRolesCommand(interaction, config, reminderUsageService, databaseService);
            break;
        case 'ocr-debug':
            await handleOcrDebugCommand(interaction, config);
            break;
        case 'decode':
            await handleDecodeCommand(interaction, sharedState);
            break;
        case 'faza1':
            await handlePhase1Command(interaction, sharedState);
            break;
        case 'wyniki':
            await handleWynikiCommand(interaction, sharedState);
            break;
        case 'progres':
            await handleProgresCommand(interaction, sharedState);
            break;
        case 'player-status':
            await handlePlayerStatusCommand(interaction, sharedState);
            break;
        case 'modyfikuj':
            await handleModyfikujCommand(interaction, sharedState);
            break;
        case 'dodaj':
            await handleDodajCommand(interaction, sharedState);
            break;
        case 'img':
            await handleImgCommand(interaction, sharedState);
            break;
        case 'faza2':
            await handlePhase2Command(interaction, sharedState);
            break;
        case 'clan-status':
            await handleClanStatusCommand(interaction, sharedState);
            break;
        case 'clan-progres':
            await handleClanProgresCommand(interaction, sharedState);
            break;
        case 'player-raport':
            await handlePlayerRaportCommand(interaction, sharedState);
            break;
        default:
            await interaction.reply({ content: 'Nieznana komenda!', flags: MessageFlags.Ephemeral });
    }
}

async function handlePunishCommand(interaction, config, ocrService, punishmentService) {
    try {
        // ===== SPRAWDZENIE KOLEJKI OCR =====
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const commandName = '/punish';

        // Sprawdź czy użytkownik ma rezerwację
        const hasReservation = ocrService.hasReservation(guildId, userId);

        // Sprawdź czy ktoś inny używa OCR
        const isOCRActive = ocrService.isOCRActive(guildId);

        // Sprawdź czy kolejka jest pusta
        const isQueueEmpty = ocrService.isQueueEmpty(guildId);

        // Określ czy użytkownik będzie dodany do kolejki
        const willBeQueued = !hasReservation && (isOCRActive || !isQueueEmpty);

        // Defer reply z odpowiednim ephemeral flag
        // TYLKO powiadomienie o kolejce jest ephemeral, embeddy analizy OCR są publiczne
        await interaction.deferReply({ ephemeral: willBeQueued });

        // Jeśli nie ma rezerwacji I (ktoś używa OCR LUB kolejka nie jest pusta) -> dodaj do kolejki
        if (willBeQueued) {
            // Ktoś inny używa OCR lub jest kolejka, dodaj do kolejki
            const { position } = await ocrService.addToOCRQueue(guildId, userId, commandName);

            const queueEmbed = new EmbedBuilder()
                .setTitle('⏳ Kolejka OCR')
                .setDescription(`System OCR jest obecnie zajęty przez innego użytkownika.\n\n` +
                               `Zostałeś dodany do kolejki na pozycji **#${position}**.\n\n` +
                               `👋 Otrzymasz powiadomienia na kanale kolejki co 30 sekund, gdy będzie Twoja kolej (masz 3 minuty na użycie komendy).\n\n` +
                               `⚠️ Jeśli nie użyjesz komendy w ciągu 3 minut od pierwszego powiadomienia, Twoja rezerwacja wygaśnie.`)
                .setColor('#ffa500')
                .setTimestamp()
                .setFooter({ text: `Komenda: ${commandName} | Pozycja w kolejce: ${position}` });

            await interaction.editReply({
                embeds: [queueEmbed]
            });
            return;
        }

        // Rozpocznij sesję OCR
        await ocrService.startOCRSession(guildId, userId, commandName);
        logger.info(`[OCR-QUEUE] 🟢 ${interaction.user.tag} rozpoczyna sesję OCR (${commandName})`);

        // Pobierz timestamp wygaśnięcia OCR z kolejki
        const activeOCR = ocrService.activeProcessing.get(guildId);
        const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

        // Utwórz sesję punishment
        const sessionId = punishmentService.createSession(userId, guildId, interaction.channelId, ocrExpiresAt);
        const session = punishmentService.getSession(sessionId);
        session.publicInteraction = interaction;

        // Pokaż embed z prośbą o zdjęcia
        const awaitingEmbed = punishmentService.createAwaitingImagesEmbed();
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PUNISH] ✅ Sesja utworzona, czekam na zdjęcia od ${interaction.user.tag}`);

    } catch (error) {
        logger.error('[PUNISH] ❌ Błąd komendy /punish:', error);

        // Zakończ sesję OCR w przypadku błędu
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        await ocrService.endOCRSession(guildId, userId, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd)`);

        await interaction.editReply({ content: messages.errors.ocrError });
    }
}

async function handleRemindCommand(interaction, config, ocrService, reminderService, reminderUsageService) {
    try {
        // ===== SPRAWDZENIE KOLEJKI OCR (przed deferReply) =====
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        const commandName = '/remind';

        // Sprawdź czy użytkownik ma rezerwację
        const hasReservation = ocrService.hasReservation(guildId, userId);

        // Sprawdź czy ktoś inny używa OCR
        const isOCRActive = ocrService.isOCRActive(guildId);

        // Sprawdź czy kolejka jest pusta
        const isQueueEmpty = ocrService.isQueueEmpty(guildId);

        // Określ czy użytkownik będzie dodany do kolejki
        const willBeQueued = !hasReservation && (isOCRActive || !isQueueEmpty);

        // Defer reply z odpowiednim ephemeral flag
        // TYLKO powiadomienie o kolejce jest ephemeral, embeddy analizy OCR są publiczne
        await interaction.deferReply({ ephemeral: willBeQueued });

        // Znajdź rolę klanu użytkownika (do sprawdzania limitów)
        let userClanRoleId = null;
        for (const [roleKey, roleId] of Object.entries(config.targetRoles)) {
            if (interaction.member.roles.cache.has(roleId)) {
                userClanRoleId = roleId;
                break;
            }
        }

        if (!userClanRoleId) {
            await interaction.editReply({
                content: '❌ Nie masz żadnej z ról klanowych. Tylko członkowie klanów mogą używać /remind.'
            });
            return;
        }

        // Sprawdź czy klan może wysłać przypomnienie (limity czasowe)
        const canSend = await reminderUsageService.canSendReminder(userClanRoleId);

        if (!canSend.canSend) {
            // Klan przekroczył limit przypomnień
            const errorEmbed = new EmbedBuilder()
                .setTitle('⏰ Limit przypomnień')
                .setDescription(canSend.reason)
                .setColor('#ff0000')
                .setTimestamp()
                .setFooter({ text: `Limit: 2 przypomnienia dziennie (per klan) | Boss deadline: 16:50` });

            await interaction.editReply({
                embeds: [errorEmbed]
            });
            return;
        }

        // Jeśli nie ma rezerwacji I (ktoś używa OCR LUB kolejka nie jest pusta) -> dodaj do kolejki
        if (willBeQueued) {
            // Ktoś inny używa OCR lub jest kolejka, dodaj do kolejki
            const { position } = await ocrService.addToOCRQueue(guildId, userId, commandName);

            const queueEmbed = new EmbedBuilder()
                .setTitle('⏳ Kolejka OCR')
                .setDescription(`System OCR jest obecnie zajęty przez innego użytkownika.\n\n` +
                               `Zostałeś dodany do kolejki na pozycji **#${position}**.\n\n` +
                               `👋 Otrzymasz powiadomienia na kanale kolejki co 30 sekund, gdy będzie Twoja kolej (masz 3 minuty na użycie komendy).\n\n` +
                               `⚠️ Jeśli nie użyjesz komendy w ciągu 3 minut od pierwszego powiadomienia, Twoja rezerwacja wygaśnie.`)
                .setColor('#ffa500')
                .setTimestamp()
                .setFooter({ text: `Komenda: ${commandName} | Pozycja w kolejce: ${position}` });

            await interaction.editReply({
                embeds: [queueEmbed]
            });
            return;
        }

        // Rozpocznij sesję OCR
        await ocrService.startOCRSession(guildId, userId, commandName);
        logger.info(`[OCR-QUEUE] 🟢 ${interaction.user.tag} rozpoczyna sesję OCR (${commandName})`);

        // Pobierz timestamp wygaśnięcia OCR z kolejki
        const activeOCR = ocrService.activeProcessing.get(guildId);
        const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

        // Utwórz sesję przypomnienia
        const sessionId = reminderService.createSession(userId, guildId, interaction.channelId, userClanRoleId, ocrExpiresAt);
        const session = reminderService.getSession(sessionId);
        session.publicInteraction = interaction;

        // Pokaż embed z prośbą o zdjęcia
        const awaitingEmbed = reminderService.createAwaitingImagesEmbed();
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[REMIND] ✅ Sesja utworzona, czekam na zdjęcia od ${interaction.user.tag}`);

    } catch (error) {
        logger.error('[REMIND] ❌ Błąd komendy /remind:', error);

        // Zakończ sesję OCR w przypadku błędu
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;
        await ocrService.endOCRSession(guildId, userId, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd)`);

        await interaction.editReply({ content: messages.errors.ocrError });
    }
}

async function handlePunishmentCommand(interaction, config, databaseService, punishmentService) {
    const category = interaction.options.getString('category');
    const roleId = config.targetRoles[category];
    
    if (!roleId) {
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', flags: MessageFlags.Ephemeral });
        return;
    }
    
    await interaction.deferReply();
    
    // Odśwież cache członków przed sprawdzeniem rankingu (z throttlingiem)
    try {
        await safeFetchMembers(interaction.guild);
    } catch (error) {
        logger.error('❌ Błąd odświeżania cache\'u:', error);
    }
    
    try {
        const ranking = await punishmentService.getRankingForRole(interaction.guild, roleId);
        const roleName = config.roleDisplayNames[category];
        
        let rankingText = '';
        if (ranking.length === 0) {
            rankingText = 'Brak użytkowników z punktami karnymi w tej kategorii.';
        } else {
            for (let i = 0; i < ranking.length && i < 10; i++) {
                const user = ranking[i];
                const punishmentEmoji = user.points >= 2 ? '🎭' : '';
                rankingText += `${i + 1}. ${user.member.displayName} - ${user.points} punktów ${punishmentEmoji}\n`;
            }
        }
        
        
        // Następne usuwanie punktów
        const nextMonday = new Date();
        nextMonday.setDate(nextMonday.getDate() + (7 - nextMonday.getDay()) % 7);
        if (nextMonday.getDay() !== 1) {
            nextMonday.setDate(nextMonday.getDate() + 1);
        }
        nextMonday.setHours(0, 0, 0, 0);
        const nextRemovalText = `${nextMonday.toLocaleDateString('pl-PL')} o 00:00`;
        
        // Kanał ostrzeżeń
        const warningChannelId = config.warningChannels[roleId];
        const warningChannel = interaction.guild.channels.cache.get(warningChannelId);
        const warningChannelText = warningChannel ? `<#${warningChannelId}>` : 'Nie znaleziono kanału';
        
        const embed = new EmbedBuilder()
            .setTitle(`📊 Ranking Punktów Karnych`)
            .setDescription(`**Kategoria:** ${roleName}\n\n${rankingText}`)
            .setColor('#ff6b6b')
            .addFields(
                { name: '⏰ Następne usuwanie punktów', value: nextRemovalText, inline: false },
                { name: '🎭 Rola karania (2+ punktów)', value: `<@&${config.punishmentRoleId}>`, inline: false },
                { name: '🚨 Rola zakazu loterii (3+ punktów)', value: `<@&${config.lotteryBanRoleId}>`, inline: false },
                { name: '📢 Kanał ostrzeżeń', value: warningChannelText, inline: false },
                { name: '⚖️ Zasady', value: '2+ punktów = rola karania\n3+ punktów = zakaz loterii\n< 2 punktów = brak roli\nOstrzeżenia: 2 i 3 punkty', inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Kategoria: ${category} | Co tydzień w poniedziałek o północy usuwany jest 1 punkt każdemu (${config.timezone})` });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        logger.error('[PUNISHMENT] ❌ Błąd komendy /punishment:', error);
        await interaction.editReply({ content: messages.errors.databaseError });
    }
}

async function handlePointsCommand(interaction, config, databaseService, punishmentService) {
    const user = interaction.options.getUser('user');
    const amount = interaction.options.getInteger('amount');
    
    await interaction.deferReply();
    
    try {
        if (amount === null || amount === undefined) {
            // Usuń użytkownika z systemu
            await databaseService.deleteUser(interaction.guild.id, user.id);
            await interaction.editReply({ content: `✅ Usunięto użytkownika ${user} z systemu punktów karnych.` });
        } else if (amount > 0) {
            // Dodaj punkty
            await punishmentService.addPointsManually(interaction.guild, user.id, amount);
            await interaction.editReply({ content: `✅ Dodano ${amount} punktów dla ${user}.` });
        } else if (amount < 0) {
            // Usuń punkty
            await punishmentService.removePointsManually(interaction.guild, user.id, Math.abs(amount));
            await interaction.editReply({ content: `✅ Usunięto ${Math.abs(amount)} punktów dla ${user}.` });
        } else {
            // amount === 0
            const userData = await databaseService.getUserPunishments(interaction.guild.id, user.id);
            await interaction.editReply({ content: `${user} ma obecnie ${userData.points} punktów karnych.` });
        }
    } catch (error) {
        logger.error('[POINTS] ❌ Błąd komendy /points:', error);
        await interaction.editReply({ content: messages.errors.databaseError });
    }
}

async function handleDebugRolesCommand(interaction, config, reminderUsageService, databaseService) {
    const category = interaction.options.getString('category');
    const roleId = config.targetRoles[category];

    if (!roleId) {
        await interaction.reply({ content: 'Nieprawidłowa kategoria!', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferReply();

    // Odśwież cache członków przed sprawdzeniem ról (z throttlingiem)
    try {
        await safeFetchMembers(interaction.guild);
    } catch (error) {
        logger.error('❌ Błąd odświeżania cache\'u:', error);
    }

    try {
        const role = interaction.guild.roles.cache.get(roleId);
        const roleName = config.roleDisplayNames[category];

        if (!role) {
            await interaction.editReply({ content: 'Nie znaleziono roli!' });
            return;
        }

        // Pobierz wszystkich członków z daną rolą
        const members = role.members;
        let membersList = '';
        let totalPunishmentPoints = 0;

        // Pobierz wszystkie punkty kary z bazy danych
        const guildPunishments = await databaseService.getGuildPunishments(interaction.guild.id);

        // Pobierz statystyki potwierdzeń odbioru (zawsze, niezależnie od liczby członków)
        const confirmations = await loadConfirmations(config);
        const confirmationStats = confirmations.userStats || {};

        if (members.size === 0) {
            membersList = 'Brak członków z tą rolą.';
        } else {
            // Pobierz statystyki przypomnień dla wszystkich członków
            const userIds = Array.from(members.keys());
            const reminderStats = await reminderUsageService.getMultipleUserStats(userIds);

            // Najpierw zlicz wszystkie punkty LIFETIME dla wszystkich członków (nie tylko widocznych)
            for (const [userId, member] of members) {
                const userPunishment = guildPunishments[userId];
                const lifetimePoints = userPunishment ? (userPunishment.lifetime_points || 0) : 0;
                totalPunishmentPoints += lifetimePoints;
            }

            // Teraz wyświetl listę członków (z limitem 50)
            const sortedMembers = members.sort((a, b) => a.displayName.localeCompare(b.displayName));
            let count = 0;
            for (const [userId, member] of sortedMembers) {
                if (count >= 50) { // Limit dla embed
                    membersList += `\n... i ${members.size - count} więcej`;
                    break;
                }

                // Pobierz punkty kary LIFETIME dla tego użytkownika
                const userPunishment = guildPunishments[userId];
                const lifetimePoints = userPunishment ? (userPunishment.lifetime_points || 0) : 0;

                // Dodaj licznik przypomnień przy nicku
                const reminderCount = reminderStats[userId] || 0;
                const reminderBadge = reminderCount > 0 ? ` [📢 ${reminderCount}]` : '';

                // Dodaj licznik potwierdzeń odbioru przy nicku
                const confirmationCount = confirmationStats[userId]?.totalConfirmations || 0;
                const confirmationBadge = confirmationCount > 0 ? ` [✅ ${confirmationCount}]` : '';

                // Sprawdź role karania i zakazu loterii
                const hasPunishmentRole = member.roles.cache.has(config.punishmentRoleId);
                const hasLotteryBanRole = member.roles.cache.has(config.lotteryBanRoleId);
                const punishmentBadge = hasPunishmentRole ? ' 🎭' : '';
                const lotteryBanBadge = hasLotteryBanRole ? ' 🚨' : '';

                // Dodaj punkty LIFETIME przy nicku jeśli ma jakieś punkty
                const pointsBadge = lifetimePoints > 0 ? ` [💀 ${lifetimePoints}]` : '';

                membersList += `${count + 1}. ${member.displayName}${punishmentBadge}${lotteryBanBadge}${pointsBadge}${reminderBadge}${confirmationBadge}\n`;
                count++;
            }
        }
        
        // Informacje o roli karania
        const punishmentRole = interaction.guild.roles.cache.get(config.punishmentRoleId);
        const punishmentRoleInfo = punishmentRole ? `<@&${config.punishmentRoleId}>` : 'Nie znaleziono';
        
        // Kanał ostrzeżeń
        const warningChannelId = config.warningChannels[roleId];
        const warningChannel = interaction.guild.channels.cache.get(warningChannelId);
        const warningChannelInfo = warningChannel ? `<#${warningChannelId}>` : 'Nie znaleziono';

        // Bezpieczne obcięcie membersList na granicy linii
        let membersListValue = membersList;
        if (membersList.length > 1024) {
            const lines = membersList.split('\n').filter(line => line.trim().length > 0);
            membersListValue = '';
            for (const line of lines) {
                if ((membersListValue + line + '\n').length > 1020) {
                    membersListValue += '...';
                    break;
                }
                membersListValue += line + '\n';
            }
            // Zabezpieczenie - jeśli lista jest pusta po obcięciu, użyj oryginalnej wiadomości
            if (membersListValue.trim().length === 0 || membersListValue === '...') {
                membersListValue = 'Lista zbyt długa do wyświetlenia';
            }
        }

        // Dodatkowe zabezpieczenie - wartość nie może być pusta
        if (!membersListValue || membersListValue.trim().length === 0) {
            membersListValue = 'Brak danych';
        }

        const embed = new EmbedBuilder()
            .setTitle(`🔧 Debug - ${roleName}`)
            .setDescription(
                `**Rola:** <@&${roleId}>\n` +
                `**ID Roli:** ${roleId}\n` +
                `**Liczba członków:** ${members.size}\n` +
                `**🏆 Suma punktów kary (kariera):** ${totalPunishmentPoints}\n\n` +
                `**🎭 Rola karania (2+ pkt):** ${punishmentRoleInfo}\n` +
                `**🚨 Rola blokady loterii (3+ pkt):** <@&${config.lotteryBanRoleId}>\n` +
                `**📢 Kanał ostrzeżeń:** ${warningChannelInfo}\n\n` +
                `**⚙️ Konfiguracja**\n` +
                `Kategoria: ${category}\n` +
                `Strefa czasowa: ${config.timezone}\n` +
                `Deadline bossa: ${config.bossDeadline.hour}:${config.bossDeadline.minute.toString().padStart(2, '0')}`
            )
            .addFields(
                { name: '👥 Członkowie', value: membersListValue, inline: false },
                { name: '📖 Legenda ikon', value: '🎭 - Rola karania (2+ punkty)\n🚨 - Blokada loterii (3+ punkty)\n💀 - Punkty kary (lifetime)\n📢 - Liczba otrzymanych przypomnień\n✅ - Liczba potwierdzeń odbioru', inline: false }
            )
            .setColor('#0099FF')
            .setTimestamp()
            .setFooter({ text: `Debug wykonany przez ${interaction.user.tag}` });
        
        await interaction.editReply({ embeds: [embed] });
    } catch (error) {
        logger.error(`[DEBUG] ❌ Błąd komendy /debug-roles: ${error.message}`);
        logger.error('[DEBUG] Stack trace:', error.stack);

        // Szczegółowe logowanie danych dla debugowania
        logger.error('[DEBUG] Category:', category);
        logger.error('[DEBUG] RoleId:', roleId);
        logger.error('[DEBUG] Members size:', members?.size);
        logger.error('[DEBUG] MembersList length:', membersList?.length);

        await interaction.editReply({ content: `❌ Wystąpił błąd podczas debugowania ról: ${error.message}` });
    }
}

async function handleSelectMenu(interaction, config, reminderService, sharedState) {
    if (interaction.customId === 'reminder_role_select') {
        const selectedRole = interaction.values[0];
        const roleId = config.targetRoles[selectedRole];

        if (!roleId) {
            await interaction.reply({ content: 'Nieprawidłowa rola!', flags: MessageFlags.Ephemeral });
            return;
        }

        await interaction.deferReply();

        try {
            await reminderService.sendBulkReminder(interaction.guild, roleId);
            await interaction.editReply({ content: `✅ Wysłano przypomnienie do roli ${config.roleDisplayNames[selectedRole]}` });
        } catch (error) {
            logger.error('[REMINDER] ❌ Błąd wysyłania przypomnienia:', error);
            await interaction.editReply({ content: messages.errors.unknownError });
        }
    } else if (interaction.customId === 'wyniki_select_clan') {
        await handleWynikiClanSelect(interaction, sharedState);
    } else if (interaction.customId === 'clan_progres_select_clan') {
        const selectedClan = interaction.values[0];
        // Aktualizuj pierwsze ephemeral reply
        await interaction.update({
            content: '⏳ Pobieram dane progresu klanu...',
            embeds: [],
            components: []
        });
        // Wyślij publiczne wyniki
        await showClanProgress(interaction, selectedClan, sharedState);
    } else if (interaction.customId === 'wyniki_select_week') {
        await handleWynikiWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_clan|')) {
        await handleModyfikujClanSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_round|')) {
        await handleModyfikujRoundSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_week_')) {
        await handleModyfikujWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_select_player_')) {
        await handleModyfikujPlayerSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_week|')) {
        await handleDodajWeekSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_round|')) {
        await handleDodajRoundSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_select_user|')) {
        await handleDodajUserSelect(interaction, sharedState);
    } else if (interaction.customId === 'img_select_clan') {
        await handleImgClanSelect(interaction, sharedState);
    } else if (interaction.customId.startsWith('img_select_week|')) {
        await handleImgWeekSelect(interaction, sharedState);
    } else if (interaction.customId === 'player_raport_select_clan') {
        await handlePlayerRaportSelectClan(interaction, sharedState);
    }
}

async function handleButton(interaction, sharedState) {
    const { config, databaseService, punishmentService, survivorService, phaseService } = sharedState;

    // Obsługa przycisków paginacji buildów
    if (interaction.customId === 'statystyki_page' || interaction.customId === 'ekwipunek_page' || interaction.customId === 'tech_party_page' || interaction.customId === 'survivor_page' || interaction.customId === 'legend_colls_page' || interaction.customId === 'epic_colls_page' || interaction.customId === 'custom_sets_page' || interaction.customId === 'pets_page') {
        if (!sharedState.buildPagination) {
            await interaction.reply({ content: '❌ Sesja paginacji wygasła.', flags: MessageFlags.Ephemeral });
            return;
        }

        const paginationData = sharedState.buildPagination.get(interaction.message.id);
        if (!paginationData) {
            await interaction.reply({ content: '❌ Nie znaleziono danych paginacji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Wszyscy użytkownicy mogą zmieniać strony

        // Ustaw nową stronę na podstawie przycisku
        let newPage = paginationData.currentPage;
        if (interaction.customId === 'statystyki_page') {
            newPage = 0;
        } else if (interaction.customId === 'ekwipunek_page') {
            newPage = 1;
        } else if (interaction.customId === 'tech_party_page') {
            newPage = 2;
        } else if (interaction.customId === 'survivor_page') {
            newPage = 3;
        } else if (interaction.customId === 'legend_colls_page') {
            newPage = 4;
        } else if (interaction.customId === 'epic_colls_page') {
            newPage = 5;
        } else if (interaction.customId === 'custom_sets_page') {
            newPage = 6;
        } else if (interaction.customId === 'pets_page') {
            newPage = 7;
        }

        // Aktualizuj dane paginacji
        paginationData.currentPage = newPage;

        // Odśwież timestamp - resetuj timer do 15 minut od teraz
        const newTimestamp = Date.now();
        paginationData.timestamp = newTimestamp;
        const deleteAt = newTimestamp + (15 * 60 * 1000);

        const navigationButtons = survivorService.createNavigationButtons(newPage);

        // Zaktualizuj footer WSZYSTKICH embedów z nowym timestampem i oglądającym
        const viewerDisplayName = interaction.member?.displayName || interaction.user.username;

        // Oblicz dokładną godzinę usunięcia
        const deleteTime = new Date(deleteAt);
        const hours = deleteTime.getHours().toString().padStart(2, '0');
        const minutes = deleteTime.getMinutes().toString().padStart(2, '0');
        const timeString = `${hours}:${minutes}`;

        // Zaktualizuj wszystkie embedy w paginacji
        paginationData.embeds.forEach((embed, index) => {
            const currentFooter = embed.data.footer?.text || '';
            const pageName = currentFooter.split(' • ')[0];
            const newFooterText = `${pageName} • Analiza zostanie usunięta o ${timeString} • Ogląda ${viewerDisplayName}`;
            embed.setFooter({ text: newFooterText });
        });

        const currentEmbed = paginationData.embeds[newPage];

        // Zaktualizuj zaplanowane usunięcie wiadomości
        if (sharedState.messageCleanupService) {
            await sharedState.messageCleanupService.removeScheduledMessage(interaction.message.id);
            await sharedState.messageCleanupService.scheduleMessageDeletion(
                interaction.message.id,
                interaction.message.channelId,
                deleteAt,
                paginationData.userId
            );
        }

        await interaction.update({
            embeds: [currentEmbed],
            components: navigationButtons
        });
        return;
    }

    // Obsługa przycisku "Usuń" dla embedów buildu
    if (interaction.customId === 'delete_embed') {
        // Po restarcie bota nie ma danych paginacji w RAM, ale wiadomość nadal istnieje
        // Pozwól na usunięcie wiadomości jeśli użytkownik jest jej właścicielem (sprawdź przez embed footer lub inne metody)

        let canDelete = false;
        let userId = null;

        // Sprawdź czy mamy dane paginacji w pamięci
        if (sharedState.buildPagination && sharedState.buildPagination.has(interaction.message.id)) {
            const paginationData = sharedState.buildPagination.get(interaction.message.id);
            userId = paginationData.userId;
            canDelete = interaction.user.id === userId;
        } else {
            // Po restarcie nie ma danych w RAM, ale sprawdź czy wiadomość jest w pliku zaplanowanych usunięć
            const scheduledMessages = sharedState.messageCleanupService.scheduledMessages || [];
            const scheduledMessage = scheduledMessages.find(msg => msg.messageId === interaction.message.id);

            if (scheduledMessage) {
                // Sprawdź czy użytkownik jest właścicielem (jeśli mamy zapisane userId)
                if (scheduledMessage.userId && scheduledMessage.userId === interaction.user.id) {
                    canDelete = true;
                } else if (!scheduledMessage.userId) {
                    // Dla starszych wiadomości bez userId, pozwól każdemu usunąć
                    canDelete = true;
                }
            }
        }

        if (!canDelete) {
            await interaction.reply({
                content: '❌ Tylko właściciel embeda może go usunąć lub sesja paginacji wygasła.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Usuń embed i dane paginacji
        try {
            // Usuń zaplanowane automatyczne usuwanie z pliku
            await sharedState.messageCleanupService.removeScheduledMessage(interaction.message.id);

            // Usuń wiadomość
            await interaction.message.delete();

            // Usuń dane paginacji z pamięci
            sharedState.buildPagination.delete(interaction.message.id);

            logger.info(`🗑️ Embed buildu został usunięty przez ${interaction.user.tag}`);
        } catch (error) {
            logger.error(`❌ Błąd usuwania embeda: ${error.message}`);
            await interaction.reply({
                content: '❌ Wystąpił błąd podczas usuwania embeda.',
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    // ============ OBSŁUGA DECYZJI O URLOPOWICZACH - REMIND ============

    if (interaction.customId === 'remind_vacation_include' || interaction.customId === 'remind_vacation_exclude') {
        const session = sharedState.reminderService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!session.vacationDecisionData) {
            await interaction.reply({ content: '❌ Brak danych o decyzjach urlopowych.', flags: MessageFlags.Ephemeral });
            return;
        }

        const { vacationDecisionData } = session;
        const { playersWithVacation, currentVacationIndex } = vacationDecisionData;

        if (currentVacationIndex >= playersWithVacation.length) {
            await interaction.reply({ content: '❌ Wszystkie decyzje zostały już podjęte.', flags: MessageFlags.Ephemeral });
            return;
        }

        const currentPlayer = playersWithVacation[currentVacationIndex];
        const userId = currentPlayer.user.member.id;
        const decision = interaction.customId === 'remind_vacation_include';

        // Zapisz decyzję
        vacationDecisionData.vacationDecisions[userId] = decision;

        logger.info(`[REMIND] 🏖️ Decyzja o ${currentPlayer.user.member.displayName}: ${decision ? 'UWZGLĘDNIJ' : 'POMIŃ'}`);

        // Przejdź do następnej osoby
        vacationDecisionData.currentVacationIndex++;

        // Defer update żeby acknowledged button click
        await interaction.deferUpdate();

        // Pokaż pytanie o następną osobę lub finalizuj (używając oryginalnej interakcji z sesji)
        try {
            await showVacationDecisionPrompt(session, 'remind', sharedState);
        } catch (error) {
            logger.error('[REMIND] ❌ Błąd przetwarzania decyzji o urlopy:', error);

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            // Wyczyść sesje
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.reminderService.cleanupSession(session.sessionId);

            // Użyj oryginalnej interakcji z sesji do pokazania błędu
            const originalInteraction = session.vacationDecisionData?.interaction || interaction;
            try {
                await originalInteraction.editReply({
                    content: `❌ Wystąpił błąd podczas przetwarzania decyzji o urlopy: ${error.message}`,
                    embeds: [],
                    components: []
                });
            } catch (replyError) {
                logger.error('[REMIND] ❌ Nie można zaktualizować wiadomości po błędzie:', replyError);
            }
        }
        return;
    }

    // ============ OBSŁUGA PRZYCISKÓW /REMIND (SYSTEM SESJI) ============

    if (interaction.customId === 'remind_cancel_session') {
        // Anuluj sesję /remind
        const session = sharedState.reminderService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Zatrzymaj ghost ping
        stopGhostPing(session);

        const cancelEmbed = new EmbedBuilder()
            .setTitle('❌ Sesja anulowana')
            .setDescription('Sesja /remind została anulowana. Wszystkie pliki zostały usunięte.')
            .setColor('#ff0000')
            .setTimestamp();

        // Najpierw odpowiedz na interaction
        await interaction.update({
            embeds: [cancelEmbed],
            components: []
        });

        // Potem wykonaj czyszczenie (asynchronicznie w tle)
        try {
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.reminderService.cleanupSession(session.sessionId);
        } catch (error) {
            logger.error(`[REMIND] ⚠️ Błąd czyszczenia sesji: ${error.message}`);
        }

        logger.info(`[REMIND] ❌ Sesja anulowana przez ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'remind_add_more') {
        // Dodaj więcej zdjęć - zmień stage na awaiting_images
        const session = sharedState.reminderService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Odśwież timeout sesji OCR
        await sharedState.ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

        session.stage = 'awaiting_images';
        sharedState.reminderService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = sharedState.reminderService.createAwaitingImagesEmbed();

        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[REMIND] ➕ Użytkownik ${interaction.user.tag} dodaje więcej zdjęć`);
        return;
    }

    if (interaction.customId === 'remind_complete_yes') {
        // Pokaż potwierdzenie końcowe i wyślij przypomnienia
        const session = sharedState.reminderService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Odśwież timeout sesji OCR
        await sharedState.ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

        // Natychmiast pokaż status "Wysyłanie..." (usuwa przyciski)
        await interaction.update({
            content: '⏳ **Wysyłanie powiadomień...**\n\nSprawdzam urlopy i wysyłam wiadomości do użytkowników.',
            embeds: [],
            components: []
        });

        // Stwórz listę znalezionych użytkowników
        const allFoundUsers = [];
        for (const imageResult of session.processedImages) {
            for (const player of imageResult.result.players) {
                allFoundUsers.push(player);
            }
        }

        // DEDUPLIKACJA: Usuń duplikaty użytkowników (ten sam gracz może mieć 0 na wielu zdjęciach)
        const uniqueUserIds = new Set();
        const foundUsers = [];
        for (const userData of allFoundUsers) {
            if (userData.user && userData.user.member) {
                const userId = userData.user.member.id;
                if (!uniqueUserIds.has(userId)) {
                    uniqueUserIds.add(userId);
                    foundUsers.push(userData);
                }
            }
        }

        logger.info(`[REMIND] 📊 Deduplikacja: ${allFoundUsers.length} znalezionych → ${foundUsers.length} unikalnych użytkowników`);

        if (foundUsers.length === 0) {
            // Zatrzymaj ghost ping
            stopGhostPing(session);

            await interaction.editReply({
                content: '❌ Nie znaleziono żadnych graczy z wynikiem 0 na przesłanych zdjęciach.',
                embeds: [],
                components: []
            });

            // Zakończ sesję OCR i wyczyść
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.reminderService.cleanupSession(session.sessionId);
            return;
        }

        // Sprawdź urlopy przed wysłaniem przypomnień
        const vacationChannelId = '1269726207633522740';
        const playersWithVacation = [];
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        try {
            const vacationChannel = await interaction.guild.channels.fetch(vacationChannelId);
            if (vacationChannel) {
                logger.info(`[REMIND] 🏖️ Sprawdzanie urlopów dla ${foundUsers.length} graczy`);

                for (const userData of foundUsers) {
                    const member = userData.user.member;
                    if (!member) continue;

                    // Sprawdź wiadomości użytkownika na kanale urlopów z ostatniego miesiąca
                    const messages = await vacationChannel.messages.fetch({ limit: 100 });
                    const userMessages = messages.filter(msg =>
                        msg.author.id === member.user.id &&
                        msg.createdAt >= oneMonthAgo
                    );

                    // Sprawdź czy któraś wiadomość ma reakcje (aktywny urlop)
                    let hasActiveVacation = false;
                    for (const userMsg of userMessages.values()) {
                        if (userMsg.reactions && userMsg.reactions.cache && userMsg.reactions.cache.size > 0) {
                            hasActiveVacation = true;
                            break;
                        }
                    }

                    if (hasActiveVacation) {
                        playersWithVacation.push(userData);
                        logger.info(`[REMIND] 🏖️ ${member.displayName} ma aktywny urlop (z reakcjami)`);
                    }
                }

                // Jeśli są urlopowicze, zapisz ich w sesji i pytaj o każdego z osobna
                if (playersWithVacation.length > 0) {
                    logger.info(`[REMIND] 🏖️ Znaleziono ${playersWithVacation.length} urlopowiczów - rozpoczynam pytanie o każdego z osobna`);

                    // Zapisz dane w sesji dla późniejszego użycia
                    session.vacationDecisionData = {
                        playersWithVacation: playersWithVacation,
                        allFoundUsers: foundUsers,
                        currentVacationIndex: 0,
                        vacationDecisions: {}, // userId -> true (include) / false (exclude)
                        interaction: interaction
                    };

                    // Pokaż pytanie o pierwszą osobę na urlopie
                    try {
                        await showVacationDecisionPrompt(session, 'remind', sharedState);
                    } catch (error) {
                        logger.error('[REMIND] ❌ Błąd wyświetlania pytania o urlopy:', error);

                        // Zatrzymaj ghost ping
                        stopGhostPing(session);

                        // Wyczyść sesje
                        await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
                        await sharedState.reminderService.cleanupSession(session.sessionId);

                        await interaction.editReply({
                            content: `❌ Wystąpił błąd podczas przetwarzania urlopów: ${error.message}`,
                            embeds: [],
                            components: []
                        });
                        return;
                    }
                    return; // Czekamy na decyzję użytkownika
                }
            }
        } catch (vacationError) {
            logger.error('[REMIND] ⚠️ Błąd sprawdzania urlopów, kontynuuję bez filtrowania:', vacationError.message);
        }

        // Wyślij przypomnienia
        try {
            const reminderResult = await sharedState.reminderService.sendReminders(interaction.guild, foundUsers);

            // Zapisz użycie /remind przez klan (dla limitów czasowych)
            await sharedState.reminderUsageService.recordRoleUsage(session.userClanRoleId, session.userId);

            // Utwórz tracking status potwierdzeń
            const members = foundUsers
                .filter(userData => userData.user && userData.user.member)
                .map(userData => userData.user.member);

            if (members.length > 0) {
                try {
                    await sharedState.reminderStatusTrackingService.createOrUpdateTracking(
                        interaction.guild,
                        session.userClanRoleId,
                        members,
                        sharedState.reminderUsageService
                    );
                    logger.info(`[REMIND] 📊 Utworzono tracking statusów dla ${members.length} użytkowników`);
                } catch (trackingError) {
                    logger.error(`[REMIND] ❌ Błąd tworzenia trackingu statusów: ${trackingError.message}`);
                }
            }

            // Przekształć foundUsers do formatu oczekiwanego przez recordPingedUsers
            const pingData = foundUsers
                .filter(userData => userData.user && userData.user.member) // Pomiń użytkowników bez member
                .map(userData => ({
                    member: userData.user.member,
                    matchedName: userData.detectedNick
                }));

            logger.info(`[REMIND] 📊 Zapisywanie statystyk pingów dla ${pingData.length} użytkowników (z ${foundUsers.length} znalezionych)`);

            // Zapisz pingi do użytkowników (dla statystyk w /debug-roles)
            if (pingData.length > 0) {
                await sharedState.reminderUsageService.recordPingedUsers(pingData);
            } else {
                logger.warn(`[REMIND] ⚠️ Brak użytkowników z member do zapisania w statystykach`);
            }

            // Zapisz dane sesji PRZED czyszczeniem (dla embeda)
            const processedImagesCount = session.processedImages.length;
            const uniqueNicksCount = session.uniqueNicks.size;

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            // Wyczyść sesję
            await sharedState.reminderService.cleanupSession(session.sessionId);

            // Oblicz czas do deadline
            const timeLeft = sharedState.reminderService.calculateTimeUntilDeadline();
            const timeMessage = messages.formatTimeMessage(timeLeft);

            // Przygotuj listę użytkowników którzy dostali powiadomienie
            const userList = foundUsers
                .filter(userData => userData.user && userData.user.member)
                .map(userData => `• ${userData.user.member.displayName}`)
                .join('\n');

            // Pokaż embed z listą użytkowników i countdown
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Przypomnienia wysłane')
                .setDescription(
                    `📤 **Wysłano powiadomienia do ${reminderResult.sentMessages} ${reminderResult.sentMessages === 1 ? 'osoby' : 'osób'}:**\n\n` +
                    `${userList}\n\n` +
                    `⏰ ${timeMessage}`
                )
                .setColor('#00ff00')
                .setFooter({ text: `Wykonano przez ${interaction.user.tag}` });

            // Sprawdź czy interakcja nie wygasła przed próbą edycji
            try {
                await interaction.editReply({
                    embeds: [successEmbed],
                    components: []
                });
            } catch (editError) {
                if (editError.code === 10008) {
                    logger.warn('[REMIND] ⚠️ Interakcja wygasła, nie można zaktualizować wiadomości');
                } else {
                    logger.error(`[REMIND] ⚠️ Błąd aktualizacji wiadomości: ${editError.message}`);
                }
            }

            logger.info(`[REMIND] ✅ Przypomnienia wysłane przez ${interaction.user.tag}`);

            // Zakończ sesję OCR natychmiast
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);

        } catch (error) {
            logger.error('[REMIND] ❌ Błąd wysyłania przypomnień');
            logger.error(`[REMIND] ❌ Error type: ${typeof error}`);
            logger.error(`[REMIND] ❌ Error object: ${error}`);

            if (error) {
                logger.error(`[REMIND] ❌ Error name: ${error?.name}`);
                logger.error(`[REMIND] ❌ Error message: ${error?.message}`);
                logger.error(`[REMIND] ❌ Error stack: ${error?.stack}`);
            }

            // Zatrzymaj ghost ping
            try {
                stopGhostPing(session);
            } catch (stopError) {
                logger.error(`[REMIND] ⚠️ Błąd zatrzymywania ghost ping: ${stopError.message}`);
            }

            // Próbuj odpowiedzieć na interakcję
            try {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas wysyłania przypomnień.',
                    embeds: [],
                    components: []
                });
            } catch (replyError) {
                logger.error(`[REMIND] ⚠️ Nie można zaktualizować interakcji: ${replyError.message}`);
            }

            // Zakończ sesję OCR i wyczyść
            try {
                await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
                await sharedState.reminderService.cleanupSession(session.sessionId);
            } catch (cleanupError) {
                logger.error(`[REMIND] ⚠️ Błąd czyszczenia sesji: ${cleanupError.message}`);
            }
        }

        return;
    }

    // ============ KONIEC OBSŁUGI PRZYCISKÓW /REMIND ============

    // ============ OBSŁUGA PRZYCISKÓW KOMEND Z KOLEJKI ============

    if (interaction.customId === 'queue_cmd_faza1') {
        await handlePhase1Command(interaction, sharedState);
        return;
    }

    if (interaction.customId === 'queue_cmd_faza2') {
        await handlePhase2Command(interaction, sharedState);
        return;
    }

    if (interaction.customId === 'queue_cmd_remind') {
        await handleRemindCommand(interaction, sharedState.config, sharedState.ocrService, sharedState.reminderService, sharedState.reminderUsageService);
        return;
    }

    if (interaction.customId === 'queue_cmd_punish') {
        await handlePunishCommand(interaction, sharedState.config, sharedState.ocrService, sharedState.punishmentService);
        return;
    }

    if (interaction.customId === 'queue_cmd_img') {
        await handleImgCommand(interaction, sharedState);
        return;
    }

    // ============ KONIEC OBSŁUGI PRZYCISKÓW KOMEND Z KOLEJKI ============

    // ============ OBSŁUGA PRZYCISKU "WYJDŹ Z KOLEJKI" ============

    if (interaction.customId === 'queue_leave') {
        const guildId = interaction.guild.id;
        const userId = interaction.user.id;

        // Sprawdź czy użytkownik ma aktywną sesję
        const activeSession = sharedState.ocrService.activeProcessing.get(guildId);
        const hasActiveSession = activeSession && activeSession.userId === userId;

        // Sprawdź czy użytkownik ma rezerwację
        const hasReservation = sharedState.ocrService.hasReservation(guildId, userId);

        // Sprawdź czy użytkownik jest w kolejce
        const queue = sharedState.ocrService.waitingQueue.get(guildId) || [];
        const isInQueue = queue.find(item => item.userId === userId);

        if (!hasActiveSession && !hasReservation && !isInQueue) {
            await interaction.reply({
                content: '❌ Nie jesteś w systemie kolejki OCR.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Jeśli ma aktywną sesję, zakończ ją
        if (hasActiveSession) {
            logger.info(`[OCR-QUEUE] 🚪 ${userId} opuszcza aktywną sesję (${activeSession.commandName})`);

            // Znajdź sesję remind/punish i zatrzymaj ghost ping
            const reminderSession = sharedState.reminderService.getSessionByUserId(userId);
            const punishSession = sharedState.punishmentService.getSessionByUserId(userId);

            if (reminderSession) {
                stopGhostPing(reminderSession);
                await sharedState.reminderService.cleanupSession(reminderSession.sessionId);
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono sesję /remind dla ${userId}`);
            }

            if (punishSession) {
                stopGhostPing(punishSession);
                await sharedState.punishmentService.cleanupSession(punishSession.sessionId);
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono sesję /punish dla ${userId}`);
            }

            // Zakończ sesję OCR (to automatycznie powiadomi następną osobę)
            await sharedState.ocrService.endOCRSession(guildId, userId, true);

            await interaction.reply({
                content: '✅ Opuściłeś aktywną sesję OCR.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Jeśli ma rezerwację, usuń ją
        if (hasReservation) {
            const reservation = sharedState.ocrService.queueReservation.get(guildId);
            if (reservation && reservation.timeout) {
                clearTimeout(reservation.timeout);
            }
            sharedState.ocrService.queueReservation.delete(guildId);
            logger.info(`[OCR-QUEUE] 🚪 ${userId} opuścił kolejkę (rezerwacja)`);

            // Usuń z kolejki jeśli tam jest
            if (isInQueue) {
                const index = queue.findIndex(item => item.userId === userId);
                if (index !== -1) {
                    queue.splice(index, 1);
                }
            }

            // Przejdź do następnej osoby w kolejce
            if (queue.length > 0) {
                const nextPerson = queue[0];
                await sharedState.ocrService.createOCRReservation(guildId, nextPerson.userId, nextPerson.commandName);
            } else {
                sharedState.ocrService.waitingQueue.delete(guildId);
            }
        } else if (isInQueue) {
            // Usuń tylko z kolejki
            const index = queue.findIndex(item => item.userId === userId);
            if (index !== -1) {
                queue.splice(index, 1);
                logger.info(`[OCR-QUEUE] 🚪 ${userId} opuścił kolejkę (pozycja ${index + 1})`);
            }

            if (queue.length === 0) {
                sharedState.ocrService.waitingQueue.delete(guildId);
            }
        }

        // Aktualizuj wyświetlanie kolejki
        await sharedState.ocrService.updateQueueDisplay(guildId);

        await interaction.reply({
            content: '✅ Opuściłeś kolejkę OCR.',
            flags: MessageFlags.Ephemeral
        });

        return;
    }

    // ============ OBSŁUGA DECYZJI O URLOPOWICZACH - PUNISH ============

    if (interaction.customId === 'punish_vacation_include' || interaction.customId === 'punish_vacation_exclude') {
        const session = sharedState.punishmentService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (!session.vacationDecisionData) {
            await interaction.reply({ content: '❌ Brak danych o decyzjach urlopowych.', flags: MessageFlags.Ephemeral });
            return;
        }

        const { vacationDecisionData } = session;
        const { playersWithVacation, currentVacationIndex } = vacationDecisionData;

        if (currentVacationIndex >= playersWithVacation.length) {
            await interaction.reply({ content: '❌ Wszystkie decyzje zostały już podjęte.', flags: MessageFlags.Ephemeral });
            return;
        }

        const currentPlayer = playersWithVacation[currentVacationIndex];
        const userId = currentPlayer.user.member.id;
        const decision = interaction.customId === 'punish_vacation_include';

        // Zapisz decyzję
        vacationDecisionData.vacationDecisions[userId] = decision;

        logger.info(`[PUNISH] 🏖️ Decyzja o ${currentPlayer.user.member.displayName}: ${decision ? 'UWZGLĘDNIJ' : 'POMIŃ'}`);

        // Przejdź do następnej osoby
        vacationDecisionData.currentVacationIndex++;

        // Defer update żeby acknowledged button click
        await interaction.deferUpdate();

        // Pokaż pytanie o następną osobę lub finalizuj (używając oryginalnej interakcji z sesji)
        try {
            await showVacationDecisionPrompt(session, 'punish', sharedState);
        } catch (error) {
            logger.error('[PUNISH] ❌ Błąd przetwarzania decyzji o urlopy:', error);

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            // Wyczyść sesje
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.punishmentService.cleanupSession(session.sessionId);

            // Użyj oryginalnej interakcji z sesji do pokazania błędu
            const originalInteraction = session.vacationDecisionData?.interaction || interaction;
            try {
                await originalInteraction.editReply({
                    content: `❌ Wystąpił błąd podczas przetwarzania decyzji o urlopy: ${error.message}`,
                    embeds: [],
                    components: []
                });
            } catch (replyError) {
                logger.error('[PUNISH] ❌ Nie można zaktualizować wiadomości po błędzie:', replyError);
            }
        }
        return;
    }

    // ============ OBSŁUGA PRZYCISKÓW /PUNISH (SYSTEM SESJI) ============

    if (interaction.customId === 'punish_cancel_session') {
        // Anuluj sesję /punish
        const session = sharedState.punishmentService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Zatrzymaj ghost ping
        stopGhostPing(session);

        const cancelEmbed = new EmbedBuilder()
            .setTitle('❌ Sesja anulowana')
            .setDescription('Sesja /punish została anulowana. Wszystkie pliki zostały usunięte.')
            .setColor('#ff0000')
            .setTimestamp();

        // Najpierw odpowiedz na interaction
        await interaction.update({
            embeds: [cancelEmbed],
            components: []
        });

        // Potem wykonaj czyszczenie (asynchronicznie w tle)
        try {
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.punishmentService.cleanupSession(session.sessionId);
        } catch (error) {
            logger.error(`[PUNISH] ⚠️ Błąd czyszczenia sesji: ${error.message}`);
        }

        logger.info(`[PUNISH] ❌ Sesja anulowana przez ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'punish_add_more') {
        // Dodaj więcej zdjęć - zmień stage na awaiting_images
        const session = sharedState.punishmentService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Odśwież timeout sesji OCR
        await sharedState.ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

        session.stage = 'awaiting_images';
        sharedState.punishmentService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = sharedState.punishmentService.createAwaitingImagesEmbed();

        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PUNISH] ➕ Użytkownik ${interaction.user.tag} dodaje więcej zdjęć`);
        return;
    }

    if (interaction.customId === 'punish_complete_yes') {
        // Pokaż potwierdzenie końcowe i dodaj punkty karne
        const session = sharedState.punishmentService.getSessionByUserId(interaction.user.id);

        if (!session) {
            await interaction.reply({ content: '❌ Nie znaleziono aktywnej sesji.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Sprawdź czy użytkownik jest właścicielem sesji
        if (session.userId !== interaction.user.id) {
            await interaction.reply({ content: '❌ To nie jest Twoja sesja.', flags: MessageFlags.Ephemeral });
            return;
        }

        // Odśwież timeout sesji OCR
        await sharedState.ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

        // Natychmiast pokaż status "Dodawanie punktów..." (usuwa przyciski)
        await interaction.update({
            content: '⏳ **Dodawanie punktów karnych...**\n\nSprawdzam urlopy i dodaję punkty użytkownikom.',
            embeds: [],
            components: []
        });

        // Stwórz listę znalezionych użytkowników
        const allFoundUsers = [];
        for (const imageResult of session.processedImages) {
            for (const player of imageResult.result.players) {
                allFoundUsers.push(player);
            }
        }

        // DEDUPLIKACJA: Usuń duplikaty użytkowników (ten sam gracz może mieć 0 na wielu zdjęciach)
        const uniqueUserIds = new Set();
        const foundUsers = [];
        for (const userData of allFoundUsers) {
            if (userData.user && userData.user.member) {
                const userId = userData.user.member.id;
                if (!uniqueUserIds.has(userId)) {
                    uniqueUserIds.add(userId);
                    foundUsers.push(userData);
                }
            }
        }

        logger.info(`[PUNISH] 📊 Deduplikacja: ${allFoundUsers.length} znalezionych → ${foundUsers.length} unikalnych użytkowników`);

        if (foundUsers.length === 0) {
            // Zatrzymaj ghost ping
            stopGhostPing(session);

            await interaction.editReply({
                content: '❌ Nie znaleziono żadnych graczy z wynikiem 0 na przesłanych zdjęciach.',
                embeds: [],
                components: []
            });

            // Zakończ sesję OCR i wyczyść
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.punishmentService.cleanupSession(session.sessionId);
            return;
        }

        // Sprawdź urlopy przed dodaniem punktów
        const vacationChannelId = '1269726207633522740';
        const playersWithVacation = [];
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);

        try {
            const vacationChannel = await interaction.guild.channels.fetch(vacationChannelId);
            if (vacationChannel) {
                logger.info(`[PUNISH] 🏖️ Sprawdzanie urlopów dla ${foundUsers.length} graczy`);

                for (const userData of foundUsers) {
                    const member = userData.user.member;
                    if (!member) continue;

                    // Sprawdź wiadomości użytkownika na kanale urlopów z ostatniego miesiąca
                    const messages = await vacationChannel.messages.fetch({ limit: 100 });
                    const userMessages = messages.filter(msg =>
                        msg.author.id === member.user.id &&
                        msg.createdAt >= oneMonthAgo
                    );

                    // Sprawdź czy któraś wiadomość ma reakcje (aktywny urlop)
                    let hasActiveVacation = false;
                    for (const userMsg of userMessages.values()) {
                        if (userMsg.reactions && userMsg.reactions.cache && userMsg.reactions.cache.size > 0) {
                            hasActiveVacation = true;
                            break;
                        }
                    }

                    if (hasActiveVacation) {
                        playersWithVacation.push(userData);
                        logger.info(`[PUNISH] 🏖️ ${member.displayName} ma aktywny urlop (z reakcjami)`);
                    }
                }

                // Jeśli są urlopowicze, zapisz ich w sesji i pytaj o każdego z osobna
                if (playersWithVacation.length > 0) {
                    logger.info(`[PUNISH] 🏖️ Znaleziono ${playersWithVacation.length} urlopowiczów - rozpoczynam pytanie o każdego z osobna`);

                    // Zapisz dane w sesji dla późniejszego użycia
                    session.vacationDecisionData = {
                        playersWithVacation: playersWithVacation,
                        allFoundUsers: foundUsers,
                        currentVacationIndex: 0,
                        vacationDecisions: {}, // userId -> true (include) / false (exclude)
                        interaction: interaction
                    };

                    // Pokaż pytanie o pierwszą osobę na urlopie
                    try {
                        await showVacationDecisionPrompt(session, 'punish', sharedState);
                    } catch (error) {
                        logger.error('[PUNISH] ❌ Błąd wyświetlania pytania o urlopy:', error);

                        // Zatrzymaj ghost ping
                        stopGhostPing(session);

                        // Wyczyść sesje
                        await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
                        await sharedState.punishmentService.cleanupSession(session.sessionId);

                        await interaction.editReply({
                            content: `❌ Wystąpił błąd podczas przetwarzania urlopów: ${error.message}`,
                            embeds: [],
                            components: []
                        });
                        return;
                    }
                    return; // Czekamy na decyzję użytkownika
                }
            }
        } catch (vacationError) {
            logger.error('[PUNISH] ⚠️ Błąd sprawdzania urlopów, kontynuuję bez filtrowania:', vacationError.message);
        }

        // Dodaj punkty karne
        try {
            const results = await sharedState.punishmentService.processPunishments(interaction.guild, foundUsers);

            // Zapisz dane sesji PRZED czyszczeniem (dla embeda)
            const processedImagesCount = session.processedImages.length;
            const uniqueNicksCount = session.uniqueNicks.size;

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            // Wyczyść sesję
            await sharedState.punishmentService.cleanupSession(session.sessionId);

            // Przygotuj listę przetworzonych użytkowników
            const processedUsers = [];
            let addedPoints = 0;

            for (const result of results) {
                const warningEmoji = result.points === 2 || result.points === 3 ? '📢' : '';
                const punishmentEmoji = result.points >= 2 ? '🎭' : '';
                processedUsers.push(`• ${result.user} - ${result.points} pkt ${punishmentEmoji}${warningEmoji}`);
                addedPoints += 1;
            }

            // Pokaż embed z listą użytkowników
            const successEmbed = new EmbedBuilder()
                .setTitle('✅ Punkty karne dodane')
                .setDescription(
                    `📈 **Dodano punkty dla ${addedPoints} ${addedPoints === 1 ? 'osoby' : 'osób'}:**\n\n` +
                    `${processedUsers.join('\n')}`
                )
                .setColor('#00ff00')
                .setFooter({ text: `${interaction.user.tag} | 🎭 = rola karania (2+ pkt) | 📢 = ostrzeżenie wysłane` });

            await interaction.editReply({
                embeds: [successEmbed],
                components: []
            });

            logger.info(`[PUNISH] ✅ Punkty karne dodane przez ${interaction.user.tag}`);

            // Zakończ sesję OCR natychmiast
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);

        } catch (error) {
            logger.error('[PUNISH] ❌ Błąd dodawania punktów karnych');
            logger.error(`[PUNISH] ❌ Error type: ${typeof error}`);
            logger.error(`[PUNISH] ❌ Error object: ${error}`);

            if (error) {
                logger.error(`[PUNISH] ❌ Error name: ${error?.name}`);
                logger.error(`[PUNISH] ❌ Error message: ${error?.message}`);
                logger.error(`[PUNISH] ❌ Error stack: ${error?.stack}`);
            }

            // Zatrzymaj ghost ping
            try {
                stopGhostPing(session);
            } catch (stopError) {
                logger.error(`[PUNISH] ⚠️ Błąd zatrzymywania ghost ping: ${stopError.message}`);
            }

            // Próbuj odpowiedzieć na interakcję
            try {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas dodawania punktów karnych.',
                    embeds: [],
                    components: []
                });
            } catch (replyError) {
                logger.error(`[PUNISH] ⚠️ Nie można zaktualizować interakcji: ${replyError.message}`);
            }

            // Zakończ sesję OCR i wyczyść
            try {
                await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
                await sharedState.punishmentService.cleanupSession(session.sessionId);
            } catch (cleanupError) {
                logger.error(`[PUNISH] ⚠️ Błąd czyszczenia sesji: ${cleanupError.message}`);
            }
        }

        return;
    }

    // ============ KONIEC OBSŁUGI PRZYCISKÓW /PUNISH ============

    if (interaction.customId === 'vacation_request') {
        // Obsługa przycisku "Zgłoś urlop"
        await sharedState.vacationService.handleVacationRequest(interaction);
        return;
    } else if (interaction.customId.startsWith('vacation_submit_')) {
        // Obsługa przycisku "Złóż wniosek o urlop"
        await sharedState.vacationService.handleVacationSubmit(interaction);
        return;
    } else if (interaction.customId.startsWith('vacation_cancel_')) {
        // Obsługa przycisku "Nie otwieraj wniosku"
        await sharedState.vacationService.handleVacationCancel(interaction);
        return;
    } else if (interaction.customId.startsWith('confirm_') && !interaction.customId.startsWith('confirm_reminder_')) {
        // Obsługa przycisków confirm_* (ale NIE confirm_reminder_* - to ma osobny handler)
        const parts = interaction.customId.split('_');
        const action = parts[1];
        const confirmationId = parts[2];
        
        const data = confirmationData.get(confirmationId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane potwierdzenia wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        // Sprawdź czy użytkownik ma prawo do potwierdzenia
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(confirmationId);
        
        try {
            switch (action) {
                case 'punish':
                    const results = await data.punishmentService.processPunishments(interaction.guild, data.foundUsers);
                    
                    // Zaktualizuj ephemeral message z potwierdzeniem
                    const punishConfirmation = new EmbedBuilder()
                        .setTitle('✅ Punkty karne dodane')
                        .setDescription('Pomyślnie dodano punkty karne dla znalezionych graczy.')
                        .setColor('#00ff00')
                        .setTimestamp()
                        .setFooter({ text: `Wykonano przez ${interaction.user.tag}` });
                    
                    await interaction.update({ 
                        embeds: [punishConfirmation],
                        components: []
                    });
                    
                    // Oryginalny embed format dla publicznej wiadomości
                    const processedUsers = [];
                    let addedPoints = 0;
                    
                    for (const result of results) {
                        const warningEmoji = result.points === 2 || result.points === 3 ? '📢' : '';
                        const punishmentEmoji = result.points >= 2 ? '🎭' : '';
                        processedUsers.push(`${result.user} - ${result.points} punktów ${punishmentEmoji}${warningEmoji}`);
                        addedPoints += 1;
                    }
                    
                    const targetMembers = interaction.guild.members.cache.filter(member =>
                        Object.values(data.config.targetRoles).some(roleId => member.roles.cache.has(roleId))
                    );

                    // Format current date and time
                    const currentDate = new Date();
                    const formattedDate = currentDate.toLocaleDateString('en-GB'); // DD.MM.YYYY
                    const formattedTime = currentDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:MM

                    // Wyślij publiczny embed z pełnym podsumowaniem
                    const punishEmbed = new EmbedBuilder()
                        .setTitle('📊 Kary Dodane')
                        .setColor('#ff6b6b')
                        .addFields(
                            { name: '🎯 Znaleziono graczy z wynikiem 0', value: `${data.zeroScorePlayers.join(', ')}`, inline: false },
                            { name: '✅ Dodano punkty karne dla', value: processedUsers.length > 0 ? processedUsers.join('\n') : 'Brak', inline: false },
                            { name: '📈 Dodano punktów', value: addedPoints.toString(), inline: true },
                            { name: '🎭 Rola karna (2+ pkt)', value: `<@&${data.config.punishmentRoleId}>`, inline: true },
                            { name: '🚨 Zakaz loterii (3+ pkt)', value: `<@&${data.config.lotteryBanRoleId}>`, inline: true }
                        )
                        .setImage(data.imageUrl)
                        .setTimestamp()
                        .setFooter({ text: `Kary dodane przez ${interaction.user.displayName || interaction.user.tag} | Boss deadline: 16:50 • ${formattedDate} ${formattedTime}` });
                    
                    await interaction.followUp({
                        embeds: [punishEmbed],
                        flags: []
                    });
                    break;
                case 'remind':
                    const reminderResult = await data.reminderService.sendReminders(interaction.guild, data.foundUsers);

                    // Zapisz użycie /remind przez klan (dla limitów czasowych)
                    await data.reminderUsageService.recordRoleUsage(data.userClanRoleId, data.originalUserId);

                    // Utwórz tracking status potwierdzeń
                    const confirmMembers = data.foundUsers
                        .filter(userData => userData.user && userData.user.member)
                        .map(userData => userData.user.member);

                    if (confirmMembers.length > 0) {
                        try {
                            await data.reminderStatusTrackingService.createOrUpdateTracking(
                                interaction.guild,
                                data.userClanRoleId,
                                confirmMembers,
                                data.reminderUsageService
                            );
                            logger.info(`[REMIND] 📊 Utworzono tracking statusów dla ${confirmMembers.length} użytkowników`);
                        } catch (trackingError) {
                            logger.error(`[REMIND] ❌ Błąd tworzenia trackingu statusów: ${trackingError.message}`);
                        }
                    }

                    // Zapisz pingi do użytkowników (dla statystyk w /debug-roles)
                    await data.reminderUsageService.recordPingedUsers(data.foundUsers);

                    // Zaktualizuj ephemeral message z potwierdzeniem
                    const confirmationSuccess = new EmbedBuilder()
                        .setTitle('✅ Przypomnienie wysłane')
                        .setDescription('Pomyślnie wysłano przypomnienia dla znalezionych graczy.')
                        .setColor('#00ff00')
                        .setTimestamp()
                        .setFooter({ text: `Wykonano przez ${interaction.user.tag}` });

                    await interaction.update({
                        embeds: [confirmationSuccess],
                        components: []
                    });
                    
                    // Oblicz czas do deadline
                    const now = new Date();
                    const polandTime = new Date(now.toLocaleString('en-US', { timeZone: data.config.timezone }));
                    const deadline = new Date(polandTime);
                    deadline.setHours(data.config.bossDeadline.hour, data.config.bossDeadline.minute, 0, 0);
                    
                    if (polandTime >= deadline) {
                        deadline.setDate(deadline.getDate() + 1);
                    }
                    
                    const timeDiff = deadline - polandTime;
                    const hours = Math.floor(timeDiff / (1000 * 60 * 60));
                    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
                    
                    let timeDisplay = '';
                    if (timeDiff > 0) {
                        if (hours > 0) {
                            timeDisplay = `${hours}h ${minutes}m`;
                        } else {
                            timeDisplay = `${minutes}m`;
                        }
                    } else {
                        timeDisplay = 'Deadline minął!';
                    }
                    
                    const matchedUsers = data.foundUsers.map(user => `${user.member} (${user.matchedName})`);

                    const imageCount = data.imageUrls.length;
                    const imageCountText = imageCount === 1 ? '1 zdjęcie' : `${imageCount} zdjęcia`;

                    // Format current date and time for reminder
                    const reminderDate = new Date();
                    const reminderFormattedDate = reminderDate.toLocaleDateString('en-GB'); // DD.MM.YYYY
                    const reminderFormattedTime = reminderDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); // HH:MM

                    // Wyślij publiczny embed z pełnym podsumowaniem
                    const reminderEmbed = new EmbedBuilder()
                        .setTitle('📢 Przypomnienie Wysłane')
                        .setColor('#ec4899')
                        .addFields(
                            { name: '🎯 Znaleziono graczy z wynikiem 0', value: `${data.zeroScorePlayers.join(', ')}`, inline: false },
                            { name: '📢 Wysłano przypomnienia dla', value: matchedUsers.length > 0 ? matchedUsers.join('\n') : 'Brak', inline: false },
                            { name: '🚨 Wysłano wiadomości', value: reminderResult.sentMessages.toString(), inline: true },
                            { name: '🔕 Na kanały', value: reminderResult.roleGroups.toString(), inline: true },
                            { name: '⏰ Pozostały czas do 16:50', value: timeDisplay, inline: true }
                        )
                        .setImage(data.imageUrls[0]) // Pierwsze zdjęcie
                        .setTimestamp()
                        .setFooter({ text: `Przypomnienie wysłane przez ${interaction.user.displayName || interaction.user.tag} | Boss deadline: 16:50 • ${reminderFormattedDate} ${reminderFormattedTime}` });
                    
                    await interaction.followUp({
                        embeds: [reminderEmbed],
                        flags: []
                    });
                    break;
            }
        } catch (error) {
            logger.error('[CONFIRM] ❌ Błąd potwierdzenia:', error.message);
            logger.error('[CONFIRM] ❌ Stack trace:', error.stack);
            await interaction.followUp({ content: messages.errors.unknownError, flags: MessageFlags.Ephemeral });
        }
    } else if (interaction.customId.startsWith('vacation_')) {
        const parts = interaction.customId.split('_');
        const choice = parts[1]; // 'yes' lub 'no'
        const vacationId = parts[2];
        
        const data = confirmationData.get(vacationId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(vacationId);
        
        let finalPlayers = data.allPlayers;
        
        if (choice === 'no') {
            // Usuń urlopowiczów z listy
            finalPlayers = data.allPlayers.filter(player => !data.playersWithVacation.includes(player));
            logger.info(`🏖️ Usunięto urlopowiczów z listy: ${data.playersWithVacation.join(', ')}`);
        } else {
            logger.info(`🏖️ Urlopowicze zostają w liście: ${data.playersWithVacation.join(', ')}`);
        }
        
        if (finalPlayers.length === 0) {
            await interaction.update({
                content: 'Brak graczy do ukarania po wykluczeniu urlopowiczów.',
                components: []
            });
            return;
        }
        
        // Sprawdź niepewne wyniki przed finalnym potwierdzeniem
        await checkUncertainResultsWithUpdate(interaction, finalPlayers, data.imageUrl, data.config, data.punishmentService, data.ocrText);
    } else if (interaction.customId.startsWith('uncertainty_')) {
        const parts = interaction.customId.split('_');
        const choice = parts[1]; // 'yes' lub 'no'
        const uncertaintyId = parts[2];
        
        const data = confirmationData.get(uncertaintyId);
        
        if (!data) {
            await interaction.reply({ content: 'Dane wygasły. Spróbuj ponownie.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        if (data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją potwierdzić.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(uncertaintyId);
        
        let finalPlayers = data.allPlayers;
        
        if (choice === 'no') {
            // Usuń niepewne wyniki z listy
            finalPlayers = data.allPlayers.filter(player => !data.uncertainPlayers.includes(player));
            logger.info(`❓ Usunięto niepewne wyniki z listy: ${data.uncertainPlayers.join(', ')}`);
        } else {
            logger.info(`❓ Niepewne wyniki zostają w liście: ${data.uncertainPlayers.join(', ')}`);
        }
        
        if (finalPlayers.length === 0) {
            await interaction.update({
                content: 'Brak graczy do ukarania po wykluczeniu niepewnych wyników.',
                components: []
            });
            return;
        }
        
        // Przejdź do finalnego potwierdzenia
        await showFinalConfirmationWithUpdate(interaction, finalPlayers, data.imageUrl, data.config, data.punishmentService);
        
    } else if (interaction.customId.startsWith('cancel_')) {
        const parts = interaction.customId.split('_');
        const confirmationId = parts[2];
        
        const data = confirmationData.get(confirmationId);
        
        if (data && data.originalUserId !== interaction.user.id) {
            await interaction.reply({ content: 'Tylko osoba, która uruchomiła komendę może ją anulować.', flags: MessageFlags.Ephemeral });
            return;
        }
        
        confirmationData.delete(confirmationId);
        
        await interaction.update({
            content: '❌ Akcja została anulowana.',
            components: [],
            embeds: []
        });
    } else if (interaction.customId === 'phase1_overwrite_yes' || interaction.customId === 'phase1_overwrite_no') {
        // Obsługa przycisków nadpisywania danych Phase 1
        await handlePhase1OverwriteButton(interaction, sharedState);
    } else if (interaction.customId === 'phase1_complete_yes' || interaction.customId === 'phase1_complete_no' || interaction.customId === 'phase1_cancel_session') {
        // Obsługa przycisków potwierdzenia zakończenia dodawania zdjęć i anulowania
        await handlePhase1CompleteButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase1_resolve_')) {
        // Obsługa przycisków rozstrzygania konfliktów
        await handlePhase1ConflictResolveButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase1_manual_')) {
        // Obsługa przycisku "Wpisz ręcznie" dla Phase 1
        await handlePhase1ManualInputButton(interaction, sharedState);
    } else if (interaction.customId === 'phase1_confirm_save' || interaction.customId === 'phase1_cancel_save') {
        // Obsługa przycisków finalnego potwierdzenia zapisu
        await handlePhase1FinalConfirmButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_confirm_') || interaction.customId === 'modyfikuj_cancel') {
        await handleModyfikujConfirmButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_page_prev|') || interaction.customId.startsWith('modyfikuj_page_next|')) {
        await handleModyfikujPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('modyfikuj_week_prev|') || interaction.customId.startsWith('modyfikuj_week_next|')) {
        await handleModyfikujWeekPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_weeks_prev|') || interaction.customId.startsWith('wyniki_weeks_next|')) {
        await handleWynikiWeekPaginationButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_phase2_view|')) {
        await handleWynikiPhase2ViewButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('wyniki_view|')) {
        await handleWynikiViewButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_overwrite_')) {
        await handlePhase2OverwriteButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_complete_') || interaction.customId.startsWith('phase2_resolve_') || interaction.customId === 'phase2_cancel_session') {
        await handlePhase2CompleteButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_manual_')) {
        // Obsługa przycisku "Wpisz ręcznie" dla Phase 2
        await handlePhase2ManualInputButton(interaction, sharedState);
    } else if (interaction.customId === 'phase2_confirm_save' || interaction.customId === 'phase2_cancel_save') {
        await handlePhase2FinalConfirmButton(interaction, sharedState);
    } else if (interaction.customId === 'phase2_round_continue') {
        await handlePhase2RoundContinue(interaction, sharedState);
    } else if (interaction.customId.startsWith('progres_nav_better|') || interaction.customId.startsWith('progres_nav_worse|')) {
        await handleProgresNavButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('clan_status_prev|') || interaction.customId.startsWith('clan_status_next|')) {
        await handleClanStatusPageButton(interaction, sharedState);
    } else if (interaction.customId.startsWith('confirm_reminder_')) {
        await handleConfirmReminderButton(interaction, sharedState);
    }
}

function hasPermission(member, allowedRoles) {
    return allowedRoles.some(roleId => member.roles.cache.has(roleId));
}

/**
 * Wysyła "ghost ping" - wiadomość z pingiem, która jest usuwana po 3 sekundach
 * Jeśli użytkownik nie kliknie przycisku, ping jest ponawiany co 30 sekund
 * @param {Object} channel - Kanał Discord
 * @param {string} userId - ID użytkownika do pingowania
 * @param {Object} session - Sesja phaseService (opcjonalne - do zapisywania timerów)
 */
async function sendGhostPing(channel, userId, session = null) {
    try {
        const pingMessage = await channel.send({
            content: `<@${userId}> Analiza zdjęć została zakończona, kontynuuj!`
        });

        // Usuń wiadomość po 3 sekundach
        setTimeout(async () => {
            try {
                await pingMessage.delete();
            } catch (error) {
                logger.error('[GHOST_PING] ❌ Nie udało się usunąć ghost pingu:', error.message);
            }
        }, 3000);

        logger.info(`[GHOST_PING] 📨 Wysłano ghost ping do użytkownika ${userId}`);

        // Jeśli mamy sesję, ustaw timer do ponawiania pingu co 30 sekund
        if (session) {
            // Wyczyść poprzedni timer jeśli istnieje
            if (session.pingTimer) {
                clearInterval(session.pingTimer);
            }

            // Ustaw nowy timer
            session.pingTimer = setInterval(async () => {
                try {
                    const repeatPingMessage = await channel.send({
                        content: `<@${userId}> Analiza zdjęć została zakończona, kontynuuj!`
                    });

                    setTimeout(async () => {
                        try {
                            await repeatPingMessage.delete();
                        } catch (error) {
                            logger.error('[GHOST_PING] ❌ Nie udało się usunąć powtarzanego ghost pingu:', error.message);
                        }
                    }, 3000);

                    logger.info(`[GHOST_PING] 🔄 Powtórzono ghost ping do użytkownika ${userId}`);
                } catch (error) {
                    logger.error('[GHOST_PING] ❌ Błąd podczas powtarzania ghost pingu:', error.message);
                }
            }, 30000); // 30 sekund

            logger.info(`[GHOST_PING] ⏰ Ustawiono timer ponawiania pingów co 30s dla sesji ${session.sessionId}`);
        }
    } catch (error) {
        logger.error('[GHOST_PING] ❌ Błąd wysyłania ghost pingu:', error.message);
    }
}

/**
 * Zatrzymuje ponawianie ghost pingów dla sesji
 * @param {Object} session - Sesja phaseService
 */
function stopGhostPing(session) {
    if (session && session.pingTimer) {
        clearInterval(session.pingTimer);
        session.pingTimer = null;
        logger.info(`[GHOST_PING] ⏹️ Zatrzymano ponawianie ghost pingów dla sesji ${session.sessionId}`);
    }
}

function createConfirmationButtons(action) {
    return new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_${action}`)
                .setLabel('Potwierdź')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`cancel_${action}`)
                .setLabel('Anuluj')
                .setStyle(ButtonStyle.Danger)
        );
}

// Funkcja do wyrejestrowania konkretnej komendy
async function unregisterCommand(client, commandName) {
    try {
        logger.info(`[COMMANDS] 🗑️ Wyrejestrowanie komendy: ${commandName}`);

        // Pobierz wszystkie komendy
        const commands = await client.application.commands.fetch();

        // Znajdź komendę do usunięcia
        const commandToDelete = commands.find(cmd => cmd.name === commandName);

        if (commandToDelete) {
            await commandToDelete.delete();
            logger.info(`[COMMANDS] ✅ Komenda ${commandName} została wyrejestrowana`);
            return true;
        } else {
            logger.info(`[COMMANDS] ⚠️ Komenda ${commandName} nie została znaleziona`);
            return false;
        }
    } catch (error) {
        logger.error(`[COMMANDS] ❌ Błąd wyrejestrowania komendy ${commandName}:`, error);
        return false;
    }
}

// Funkcja do rejestracji komend slash
async function registerSlashCommands(client) {
    const commands = [
        new SlashCommandBuilder()
            .setName('punish')
            .setDescription('Analizuj zdjęcia i znajdź graczy z wynikiem 0 (wrzuć screeny po uruchomieniu)'),
        
        new SlashCommandBuilder()
            .setName('remind')
            .setDescription('Wyślij przypomnienie o bossie dla graczy z wynikiem 0 (wrzuć screeny po uruchomieniu)'),

        new SlashCommandBuilder()
            .setName('punishment')
            .setDescription('Wyświetl ranking punktów karnych')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria rankingu')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('points')
            .setDescription('Dodaj lub odejmij punkty użytkownikowi')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('Użytkownik')
                    .setRequired(true)
            )
            .addIntegerOption(option =>
                option.setName('amount')
                    .setDescription('Liczba punktów (dodatnia = dodaj, ujemna = odejmij, puste = usuń użytkownika)')
                    .setRequired(false)
                    .setMinValue(-20)
                    .setMaxValue(20)
            ),
        
        new SlashCommandBuilder()
            .setName('debug-roles')
            .setDescription('Debugowanie ról na serwerze (tylko dla moderatorów)')
            .addStringOption(option =>
                option.setName('category')
                    .setDescription('Kategoria do sprawdzenia')
                    .setRequired(true)
                    .addChoices(
                        { name: '🎮PolskiSquad⁰🎮', value: '0' },
                        { name: '⚡PolskiSquad¹⚡', value: '1' },
                        { name: '💥PolskiSquad²💥', value: '2' },
                        { name: '🔥Polski Squad🔥', value: 'main' }
                    )
            ),
        
        new SlashCommandBuilder()
            .setName('ocr-debug')
            .setDescription('Przełącz szczegółowe logowanie OCR')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('Włącz (true) lub wyłącz (false) szczegółowe logowanie')
                    .setRequired(false)
            ),

        new SlashCommandBuilder()
            .setName('decode')
            .setDescription('Dekoduj kod buildu Survivor.io i wyświetl dane o ekwipunku'),

        new SlashCommandBuilder()
            .setName('faza1')
            .setDescription('Zbierz i zapisz wyniki wszystkich graczy dla Fazy 1'),

        new SlashCommandBuilder()
            .setName('wyniki')
            .setDescription('Wyświetl wyniki dla wszystkich faz'),

        new SlashCommandBuilder()
            .setName('progres')
            .setDescription('Wyświetla wykres progresów gracza z ostatnich 54 tygodni')
            .addStringOption(option =>
                option.setName('nick')
                    .setDescription('Nick gracza (wyszukaj z listy lub wpisz własny)')
                    .setRequired(true)
                    .setAutocomplete(true)
            ),

        new SlashCommandBuilder()
            .setName('modyfikuj')
            .setDescription('Modyfikuj wynik gracza')
            .addStringOption(option =>
                option.setName('faza')
                    .setDescription('Wybierz fazę')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Faza 1', value: 'phase1' },
                        { name: 'Faza 2', value: 'phase2' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('dodaj')
            .setDescription('Dodaj nowego gracza do istniejących wyników')
            .addStringOption(option =>
                option.setName('faza')
                    .setDescription('Wybierz fazę')
                    .setRequired(true)
                    .addChoices(
                        { name: 'Faza 1', value: 'phase1' },
                        { name: 'Faza 2', value: 'phase2' }
                    )
            ),

        new SlashCommandBuilder()
            .setName('img')
            .setDescription('Dodaj zdjęcie z tabelą wyników do tygodnia Fazy 2'),

        new SlashCommandBuilder()
            .setName('faza2')
            .setDescription('Zbierz i zapisz wyniki wszystkich graczy dla Fazy 2 (3 rundy)'),

        new SlashCommandBuilder()
            .setName('clan-status')
            .setDescription('Wyświetla globalny ranking wszystkich graczy ze wszystkich klanów'),

        new SlashCommandBuilder()
            .setName('clan-progres')
            .setDescription('Wyświetla progres TOP30 dla wybranego klanu przez ostatnie tygodnie'),

        new SlashCommandBuilder()
            .setName('player-status')
            .setDescription('Kompleksowy raport o graczu: progres, kary, status w klanie i ranking')
            .addStringOption(option =>
                option.setName('nick')
                    .setDescription('Nick gracza (wyszukaj z listy lub wpisz własny)')
                    .setRequired(true)
                    .setAutocomplete(true)
            ),

        new SlashCommandBuilder()
            .setName('player-raport')
            .setDescription('Wyświetla raport problematycznych graczy w klanie (tylko dla adminów/moderatorów)')
    ];

    try {
        await client.application.commands.set(commands);
    } catch (error) {
        logger.error('[COMMANDS] ❌ Błąd rejestracji komend:', error);
    }
}

async function checkVacationsBeforeConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService, ocrText = '') {
    const vacationChannelId = '1269726207633522740';
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    
    try {
        logger.info(`🏖️ Rozpoczynam sprawdzanie urlopów dla ${zeroScorePlayers.length} graczy`);
        
        const vacationChannel = await interaction.guild.channels.fetch(vacationChannelId);
        if (!vacationChannel) {
            logger.warn('Kanał urlopów nie znaleziony, pomijam sprawdzenie');
            return await showFinalConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService);
        }
        
        const playersWithVacation = [];
        
        // Sprawdź każdego gracza
        for (const playerNick of zeroScorePlayers) {
            // Znajdź członka serwera po nicku
            const members = await interaction.guild.members.fetch();
            const member = members.find(m => m.displayName.toLowerCase() === playerNick.toLowerCase());
            
            if (member) {
                // Sprawdź wiadomości na kanale urlopów
                const messages = await vacationChannel.messages.fetch({ limit: 100 });
                const userMessages = messages.filter(msg => 
                    msg.author.id === member.user.id && 
                    msg.createdAt >= oneMonthAgo
                );
                
                // Sprawdź czy któraś z wiadomości ma obecnie reakcje (sprawdzenie w czasie rzeczywistym)
                let hasActiveVacation = false;
                for (const userMsg of userMessages.values()) {
                    if (userMsg.reactions && userMsg.reactions.cache && userMsg.reactions.cache.size > 0) {
                        hasActiveVacation = true;
                        break;
                    }
                }
                
                if (hasActiveVacation) {
                    playersWithVacation.push(playerNick);
                    logger.info(`🏖️ ${playerNick} ma aktywny urlop (z reakcjami)`);
                } else if (userMessages.size > 0) {
                    logger.info(`🏖️ ${playerNick} miał urlop, ale bez reakcji - będzie uwzględniony w karach`);
                }
            }
        }
        
        if (playersWithVacation.length > 0) {
            // Pokaż pytanie o urlopowiczów
            await showVacationQuestion(interaction, playersWithVacation, zeroScorePlayers, imageUrl, config, punishmentService, ocrText);
        } else {
            // Sprawdź niepewne wyniki (© na końcu linii) przed finalnym potwierdzeniem
            await checkUncertainResults(interaction, zeroScorePlayers, imageUrl, config, punishmentService, ocrText);
        }
        
    } catch (error) {
        logger.error('❌ Błąd sprawdzania urlopów:', error.message);
        logger.error('❌ Stack trace:', error.stack);
        try {
            await showFinalConfirmation(interaction, zeroScorePlayers, imageUrl, config, punishmentService);
        } catch (fallbackError) {
            logger.error('❌ Błąd fallback confirmation:', fallbackError.message);
            await interaction.editReply('❌ Wystąpił błąd podczas sprawdzania urlopów.');
        }
    }
}

async function checkUncertainResults(interaction, players, imageUrl, config, punishmentService, ocrText) {
    // Sprawdź które graczy mają symbol © na końcu linii
    const uncertainPlayers = [];
    const certainPlayers = [];
    
    for (const player of players) {
        // Znajdź linię z tym graczem w tekście OCR
        const lines = ocrText.split('\n');
        let hasUncertainty = false;
        
        for (const line of lines) {
            const normalizedLine = line.toLowerCase();
            const normalizedPlayer = player.toLowerCase();
            
            if (normalizedLine.includes(normalizedPlayer) && line.trim().endsWith('©')) {
                hasUncertainty = true;
                break;
            }
        }
        
        if (hasUncertainty) {
            uncertainPlayers.push(player);
        } else {
            certainPlayers.push(player);
        }
    }
    
    if (uncertainPlayers.length > 0) {
        // Pokaż pytanie o niepewne wyniki
        await showUncertaintyQuestion(interaction, uncertainPlayers, players, imageUrl, config, punishmentService);
    } else {
        // Przejdź do normalnego potwierdzenia
        await showFinalConfirmation(interaction, players, imageUrl, config, punishmentService);
    }
}

async function checkUncertainResultsWithUpdate(interaction, players, imageUrl, config, punishmentService, ocrText) {
    // Sprawdź które graczy mają symbol © na końcu linii
    const uncertainPlayers = [];
    const certainPlayers = [];
    
    for (const player of players) {
        // Znajdź linię z tym graczem w tekście OCR
        const lines = ocrText.split('\n');
        let hasUncertainty = false;
        
        for (const line of lines) {
            const normalizedLine = line.toLowerCase();
            const normalizedPlayer = player.toLowerCase();
            
            if (normalizedLine.includes(normalizedPlayer) && line.trim().endsWith('©')) {
                hasUncertainty = true;
                break;
            }
        }
        
        if (hasUncertainty) {
            uncertainPlayers.push(player);
        } else {
            certainPlayers.push(player);
        }
    }
    
    if (uncertainPlayers.length > 0) {
        // Pokaż pytanie o niepewne wyniki
        await showUncertaintyQuestionWithUpdate(interaction, uncertainPlayers, players, imageUrl, config, punishmentService);
    } else {
        // Przejdź do normalnego potwierdzenia
        await showFinalConfirmationWithUpdate(interaction, players, imageUrl, config, punishmentService);
    }
}

async function showUncertaintyQuestion(interaction, uncertainPlayers, allPlayers, imageUrl, config, punishmentService) {
    const uncertaintyId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(uncertaintyId, {
        action: 'uncertainty_check',
        uncertainPlayers: uncertainPlayers,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(uncertaintyId);
    }, 5 * 60 * 1000);
    
    const playersText = uncertainPlayers.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`uncertainty_yes_${uncertaintyId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`uncertainty_no_${uncertaintyId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    const embed = new EmbedBuilder()
        .setTitle('❓ Niepewny wynik OCR')
        .setDescription(`Bot nie jest pewny wyniku dla: ${playersText} (wykryto symbol ©).\nCzy dodać ${uncertainPlayers.length > 1 ? 'tych graczy' : 'tego gracza'} do listy z zerami?`)
        .setColor('#FFA500')
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Sprawdź obraz i zdecyduj • Żądanie od ${interaction.user.tag}` });
    
    await interaction.editReply({
        embeds: [embed],
        components: [row]
    });
}

async function showUncertaintyQuestionWithUpdate(interaction, uncertainPlayers, allPlayers, imageUrl, config, punishmentService) {
    const uncertaintyId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(uncertaintyId, {
        action: 'uncertainty_check',
        uncertainPlayers: uncertainPlayers,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(uncertaintyId);
    }, 5 * 60 * 1000);
    
    const playersText = uncertainPlayers.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`uncertainty_yes_${uncertaintyId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`uncertainty_no_${uncertaintyId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    const embed = new EmbedBuilder()
        .setTitle('❓ Niepewny wynik OCR')
        .setDescription(`Bot nie jest pewny wyniku dla: ${playersText} (wykryto symbol ©).\nCzy dodać ${uncertainPlayers.length > 1 ? 'tych graczy' : 'tego gracza'} do listy z zerami?`)
        .setColor('#FFA500')
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Sprawdź obraz i zdecyduj • Żądanie od ${interaction.user.tag}` });
    
    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

async function showVacationQuestion(interaction, playersWithVacation, allPlayers, imageUrl, config, punishmentService, ocrText = '') {
    const vacationId = Date.now().toString();
    
    // Zapisz dane do mapy
    confirmationData.set(vacationId, {
        action: 'vacation_check',
        playersWithVacation: playersWithVacation,
        allPlayers: allPlayers,
        imageUrl: imageUrl,
        config: config,
        punishmentService: punishmentService,
        originalUserId: interaction.user.id,
        ocrText: ocrText
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(vacationId);
    }, 5 * 60 * 1000);
    
    const playersText = playersWithVacation.map(nick => `**${nick}**`).join(', ');
    
    const yesButton = new ButtonBuilder()
        .setCustomId(`vacation_yes_${vacationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const noButton = new ButtonBuilder()
        .setCustomId(`vacation_no_${vacationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(yesButton, noButton);
    
    await interaction.editReply({
        content: `🏖️ ${playersText} zgłaszał/a urlop w ostatnim czasie.\nCzy w takim razie dodać punkty kary?`,
        components: [row]
    });
}

async function showFinalConfirmation(interaction, finalPlayers, imageUrl, config, punishmentService) {
    const confirmationId = Date.now().toString();
    
    // Konwertuj nicki na obiekty z członkami dla punishmentService
    const foundUserObjects = [];
    for (const nick of finalPlayers) {
        const member = interaction.guild.members.cache.find(m => 
            m.displayName.toLowerCase() === nick.toLowerCase() || 
            m.user.username.toLowerCase() === nick.toLowerCase()
        );
        if (member) {
            foundUserObjects.push({ 
                userId: member.id,
                member: member, 
                matchedName: nick 
            });
        }
    }
    
    // Zapisz dane do mapy
    confirmationData.set(confirmationId, {
        action: 'punish',
        foundUsers: foundUserObjects,
        zeroScorePlayers: finalPlayers,
        imageUrl: imageUrl,
        originalUserId: interaction.user.id,
        config: config,
        punishmentService: punishmentService
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(confirmationId);
    }, 5 * 60 * 1000);
    
    const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_punish_${confirmationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_punish_${confirmationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);
    
    const confirmationEmbed = new EmbedBuilder()
        .setTitle('⚖️ Potwierdź Dodanie Punktów Karnych')
        .setDescription('Czy chcesz dodać punkty karne znalezionym graczom?')
        .setColor('#ff6b6b')
        .addFields(
            { name: `🎯 Znaleziono ${finalPlayers.length} graczy z wynikiem 0`, value: `${finalPlayers.join(', ')}`, inline: false }
        )
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Żądanie od ${interaction.user.tag} | Potwierdź lub anuluj w ciągu 5 minut` });
    
    await interaction.editReply({ 
        embeds: [confirmationEmbed],
        components: [row]
    });
}

async function showFinalConfirmationWithUpdate(interaction, finalPlayers, imageUrl, config, punishmentService) {
    const confirmationId = Date.now().toString();
    
    // Konwertuj nicki na obiekty z członkami dla punishmentService
    const foundUserObjects = [];
    for (const nick of finalPlayers) {
        const member = interaction.guild.members.cache.find(m => 
            m.displayName.toLowerCase() === nick.toLowerCase() || 
            m.user.username.toLowerCase() === nick.toLowerCase()
        );
        if (member) {
            foundUserObjects.push({ 
                userId: member.id,
                member: member, 
                matchedName: nick 
            });
        }
    }
    
    // Zapisz dane do mapy
    confirmationData.set(confirmationId, {
        action: 'punish',
        foundUsers: foundUserObjects,
        zeroScorePlayers: finalPlayers,
        imageUrl: imageUrl,
        originalUserId: interaction.user.id,
        config: config,
        punishmentService: punishmentService
    });
    
    // Usuń dane po 5 minut
    setTimeout(() => {
        confirmationData.delete(confirmationId);
    }, 5 * 60 * 1000);
    
    const confirmButton = new ButtonBuilder()
        .setCustomId(`confirm_punish_${confirmationId}`)
        .setLabel('✅ Tak')
        .setStyle(ButtonStyle.Success);
    
    const cancelButton = new ButtonBuilder()
        .setCustomId(`cancel_punish_${confirmationId}`)
        .setLabel('❌ Nie')
        .setStyle(ButtonStyle.Danger);
    
    const row = new ActionRowBuilder()
        .addComponents(confirmButton, cancelButton);
    
    const confirmationEmbed = new EmbedBuilder()
        .setTitle('⚖️ Potwierdź Dodanie Punktów Karnych')
        .setDescription('Czy chcesz dodać punkty karne znalezionym graczom?')
        .setColor('#ff6b6b')
        .addFields(
            { name: `🎯 Znaleziono ${finalPlayers.length} graczy z wynikiem 0`, value: `${finalPlayers.join(', ')}`, inline: false }
        )
        .setImage(imageUrl)
        .setTimestamp()
        .setFooter({ text: `Żądanie od ${interaction.user.tag} | Potwierdź lub anuluj w ciągu 5 minut` });
    
    await interaction.update({ 
        embeds: [confirmationEmbed],
        components: [row]
    });
}

async function handleOcrDebugCommand(interaction, config) {
    // Sprawdź uprawnienia administratora
    if (!interaction.member.permissions.has('Administrator')) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator**',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const enabled = interaction.options.getBoolean('enabled');

    if (enabled === null) {
        // Sprawdź aktualny stan
        const currentState = config.ocr.detailedLogging.enabled;
        await interaction.reply({
            content: `🔍 **Szczegółowe logowanie OCR:** ${currentState ? '✅ Włączone' : '❌ Wyłączone'}`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Przełącz stan
    config.ocr.detailedLogging.enabled = enabled;

    const statusText = enabled ? '✅ Włączone' : '❌ Wyłączone';
    const emoji = enabled ? '🔍' : '🔇';

    logger.info(`${emoji} Szczegółowe logowanie OCR zostało ${enabled ? 'włączone' : 'wyłączone'} przez ${interaction.user.tag}`);

    await interaction.reply({
        content: `${emoji} **Szczegółowe logowanie OCR:** ${statusText}`,
        flags: MessageFlags.Ephemeral
    });
}

async function handleDecodeCommand(interaction, sharedState) {
    const { config, survivorService } = sharedState;

    // Sprawdź czy kanał jest zablokowany dla komendy /decode
    const currentChannelId = interaction.channelId;
    const parentChannelId = interaction.channel?.parent?.id;

    // Sprawdź czy to kanał dozwolony lub wątek w dozwolonym kanale
    const isAllowedChannel = config.allowedDecodeChannels.includes(currentChannelId) ||
                            config.allowedDecodeChannels.includes(parentChannelId);

    // Administratorzy i moderatorzy mogą używać komendy wszędzie
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAllowedChannel && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Komenda `/decode` jest dostępna tylko na wybranych kanałach.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wyświetl modal z polem do wpisania kodu
    const modal = new ModalBuilder()
        .setCustomId('decode_modal')
        .setTitle('Dekoduj build Survivor.io');

    const codeInput = new TextInputBuilder()
        .setCustomId('build_code')
        .setLabel('Kod buildu')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Skopiuj tu kod otrzymany po kliknięciu "EXPORT" na stronie https://sio-tools.vercel.app/')
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(4000);

    const actionRow = new ActionRowBuilder().addComponents(codeInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

async function handleModalSubmit(interaction, sharedState) {
    if (interaction.customId === 'decode_modal') {
        await handleDecodeModalSubmit(interaction, sharedState);
    // Modal wyniki_attachments_modal został usunięty - teraz używamy przesyłania plików bezpośrednio
    } else if (interaction.customId.startsWith('modyfikuj_modal_')) {
        await handleModyfikujModalSubmit(interaction, sharedState);
    } else if (interaction.customId.startsWith('dodaj_modal|')) {
        await handleDodajModalSubmit(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase1_manual_modal_')) {
        await handlePhase1ManualModalSubmit(interaction, sharedState);
    } else if (interaction.customId.startsWith('phase2_manual_modal_')) {
        await handlePhase2ManualModalSubmit(interaction, sharedState);
    }
}

async function handlePhase1Command(interaction, sharedState) {
    const { config, phaseService, databaseService, ocrService } = sharedState;
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const commandName = '/faza1';

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ===== SPRAWDZENIE KOLEJKI OCR (przed deferReply) =====
    // Sprawdź czy użytkownik ma rezerwację
    const hasReservation = ocrService.hasReservation(guildId, userId);

    // Sprawdź czy ktoś inny używa OCR
    const isOCRActive = ocrService.isOCRActive(guildId);

    // Sprawdź czy kolejka jest pusta
    const isQueueEmpty = ocrService.isQueueEmpty(guildId);

    // Określ czy użytkownik będzie dodany do kolejki
    const willBeQueued = !hasReservation && (isOCRActive || !isQueueEmpty);

    // Defer reply z odpowiednim ephemeral flag
    // TYLKO powiadomienie o kolejce jest ephemeral, embeddy analizy OCR są publiczne
    await interaction.deferReply({ ephemeral: willBeQueued });

    try {
        // Wykryj klan użytkownika
        const targetRoleIds = Object.entries(config.targetRoles);
        let userClan = null;

        for (const [clanKey, roleId] of targetRoleIds) {
            if (interaction.member.roles.cache.has(roleId)) {
                userClan = clanKey;
                logger.info(`[PHASE1] 🎯 Wykryto klan użytkownika: ${clanKey} (${config.roleDisplayNames[clanKey]})`);
                break;
            }
        }

        if (!userClan) {
            await interaction.editReply({
                content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról: ' +
                    Object.values(config.roleDisplayNames).join(', ')
            });
            return;
        }

        // Jeśli nie ma rezerwacji I (ktoś używa OCR LUB kolejka nie jest pusta) -> dodaj do kolejki
        if (willBeQueued) {
            // Ktoś inny używa OCR lub jest kolejka, dodaj do kolejki
            const { position } = await ocrService.addToOCRQueue(guildId, userId, commandName);

            const queueEmbed = new EmbedBuilder()
                .setTitle('⏳ Kolejka OCR')
                .setDescription(`System OCR jest obecnie zajęty przez innego użytkownika.\n\n` +
                               `Zostałeś dodany do kolejki na pozycji **#${position}**.\n\n` +
                               `👋 Otrzymasz powiadomienia na kanale kolejki co 30 sekund, gdy będzie Twoja kolej (masz 3 minuty na użycie komendy).\n\n` +
                               `⚠️ Jeśli nie użyjesz komendy w ciągu 3 minut od pierwszego powiadomienia, Twoja rezerwacja wygaśnie.`)
                .setColor('#ffa500')
                .setTimestamp()
                .setFooter({ text: `Komenda: ${commandName} | Pozycja w kolejce: ${position}` });

            await interaction.editReply({
                embeds: [queueEmbed]
            });
            return;
        }

        // Rozpocznij sesję OCR
        await ocrService.startOCRSession(guildId, userId, commandName);
        logger.info(`[OCR-QUEUE] 🟢 ${interaction.user.tag} rozpoczyna sesję OCR (${commandName})`);

        // Pobierz timestamp wygaśnięcia OCR z kolejki
        const activeOCR = ocrService.activeProcessing.get(guildId);
        const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

        // Sprawdź czy dane dla tego tygodnia i klanu już istnieją
        const weekInfo = phaseService.getCurrentWeekInfo();
        const existingData = await databaseService.checkPhase1DataExists(
            interaction.guild.id,
            weekInfo.weekNumber,
            weekInfo.year,
            userClan
        );

        if (existingData.exists) {
            // Pokaż ostrzeżenie z przyciskami
            const warningEmbed = await phaseService.createOverwriteWarningEmbed(
                interaction.guild.id,
                weekInfo,
                userClan,
                1,
                interaction.guild
            );

            if (warningEmbed) {
                await interaction.editReply({
                    embeds: [warningEmbed.embed],
                    components: [warningEmbed.row]
                });
                return;
            }
        }

        // Utwórz sesję
        const sessionId = phaseService.createSession(
            interaction.user.id,
            interaction.guild.id,
            interaction.channelId,
            1, // phase
            ocrExpiresAt // timestamp OCR
        );

        const session = phaseService.getSession(sessionId);
        session.publicInteraction = interaction;
        session.clan = userClan;

        // Pokaż embed z prośbą o zdjęcia (PUBLICZNY)
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE1] ✅ Sesja utworzona, czekam na zdjęcia od ${interaction.user.tag}`);

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd komendy /faza1:', error);

        // Zakończ sesję OCR w przypadku błędu
        await ocrService.endOCRSession(guildId, userId, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd)`);

        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas inicjalizacji komendy /faza1.'
        });
    }
}

async function handleDecodeModalSubmit(interaction, sharedState) {
    const { config, survivorService } = sharedState;

    const code = interaction.fields.getTextInputValue('build_code');

    if (!code || code.trim().length === 0) {
        await interaction.reply({
            content: '❌ Nie podano kodu do dekodowania.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        const buildData = survivorService.decodeBuild(code.trim());

        if (!buildData.success) {
            await interaction.editReply({
                content: `❌ **Nie udało się zdekodować kodu**\n\n**Błąd:** ${buildData.error}\n**Kod:** \`${code}\``,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const userDisplayName = interaction.member?.displayName || interaction.user.username;
        const viewerDisplayName = interaction.member?.displayName || interaction.user.username;
        const embeds = await survivorService.createBuildEmbeds(buildData.data, userDisplayName, code, viewerDisplayName);
        const navigationButtons = survivorService.createNavigationButtons(0);
        const response = await interaction.editReply({
            embeds: [embeds[0]], // Rozpocznij od pierwszej strony
            components: navigationButtons
        });

        // Przechowuj dane dla paginacji
        if (!sharedState.buildPagination) {
            sharedState.buildPagination = new Map();
        }

        sharedState.buildPagination.set(response.id, {
            embeds: embeds,
            currentPage: 0,
            userId: interaction.user.id,
            timestamp: Date.now()
        });

        // Zaplanuj usunięcie wiadomości po 15 minutach (persist across restarts)
        const deleteAt = Date.now() + (15 * 60 * 1000); // 15 minut
        await sharedState.messageCleanupService.scheduleMessageDeletion(
            response.id,
            response.channelId,
            deleteAt,
            interaction.user.id // Zapisz właściciela
        );

        // Usuń dane paginacji po 15 minutach (tylko jeśli bot nie zostanie zrestartowany)
        setTimeout(() => {
            if (sharedState.buildPagination && sharedState.buildPagination.has(response.id)) {
                sharedState.buildPagination.delete(response.id);
            }
        }, 15 * 60 * 1000);

        logger.info(`✅ Pomyślnie zdekodowano build Survivor.io dla ${interaction.user.tag}`);

    } catch (error) {
        logger.error(`❌ Błąd dekodowania build Survivor.io: ${error.message}`);

        await interaction.editReply({
            content: `❌ **Wystąpił błąd podczas dekodowania**\n\n**Błąd:** ${error.message}\n**Kod:** \`${code}\``,
            flags: MessageFlags.Ephemeral
        });
    }
}

// =============== PHASE 1 HANDLERS ===============

async function handlePhase1OverwriteButton(interaction, sharedState) {
    const { phaseService, config, ocrService } = sharedState;

    if (interaction.customId === 'phase1_overwrite_no') {
        // Anuluj - zakończ sesję OCR
        await ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie Phase1)`);

        // Próbuj zaktualizować wiadomość (może być już usunięta przez cleanup)
        try {
            await interaction.update({
                content: '❌ Operacja anulowana.',
                embeds: [],
                components: []
            });
        } catch (updateError) {
            // Wiadomość została już usunięta przez cleanupQueueChannelMessages - to OK
            logger.info(`[PHASE1] ℹ️ Nie można zaktualizować wiadomości (prawdopodobnie już usunięta): ${updateError.message}`);
        }
        return;
    }

    // Wykryj klan użytkownika ponownie
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.update({
            content: '❌ Nie wykryto Twojego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    // Nadpisz - sesja OCR już aktywna (została rozpoczęta w handlePhase1Command)

    // Pobierz timestamp wygaśnięcia OCR z kolejki
    const activeOCR = ocrService.activeProcessing.get(interaction.guild.id);
    const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

    const sessionId = phaseService.createSession(
        interaction.user.id,
        interaction.guild.id,
        interaction.channelId,
        1, // phase
        ocrExpiresAt // timestamp OCR
    );

    const session = phaseService.getSession(sessionId);
    session.publicInteraction = interaction;
    session.clan = userClan;

    const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
    await interaction.update({
        embeds: [awaitingEmbed.embed],
        components: [awaitingEmbed.row]
    });

    logger.info(`[PHASE1] ✅ Sesja utworzona (nadpisywanie), czekam na zdjęcia od ${interaction.user.tag}`);
}

async function handlePhase1CompleteButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może ją potwierdzić.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    if (interaction.customId === 'phase1_cancel_session') {
        // WAŻNE: Najpierw zaktualizuj wiadomość, potem usuń sesję
        await interaction.update({
            content: '❌ Sesja anulowana.',
            embeds: [],
            components: []
        });

        // Anuluj sesję (cleanupSession wywołuje endOCRSession gdy to bezpieczne)
        await phaseService.cleanupSession(session.sessionId);

        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie Phase1)`);
        logger.info(`[PHASE1] ❌ Sesja anulowana przez użytkownika: ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'phase1_complete_no') {
        // Dodaj więcej zdjęć
        session.stage = 'awaiting_images';
        phaseService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = phaseService.createAwaitingImagesEmbed();
        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE1] ➕ Użytkownik chce dodać więcej zdjęć`);
        return;
    }

    // Tak, analizuj
    await interaction.update({
        content: '🔄 Analizuję wyniki...',
        embeds: [],
        components: []
    });

    try {
        // Identyfikuj konflikty
        const conflicts = phaseService.identifyConflicts(session);

        if (conflicts.length > 0) {
            // Przejdź do rozstrzygania konfliktów
            session.stage = 'resolving_conflicts';
            const firstConflict = phaseService.getNextUnresolvedConflict(session);

            if (firstConflict) {
                const conflictEmbed = phaseService.createConflictEmbed(firstConflict, 1, conflicts.length, 1);
                await interaction.editReply({
                    embeds: [conflictEmbed.embed],
                    components: [conflictEmbed.row]
                });
            }
        } else {
            // Brak konfliktów - przejdź do finalnego podsumowania
            await showPhase1FinalSummary(interaction, session, phaseService);
        }

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd analizy wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas analizy wyników.'
        });
    }
}

async function handlePhase1ConflictResolveButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może rozstrzygać konflikty.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    // Wyciągnij nick i wartość z customId
    // Format: phase1_resolve_{nick}_{value}
    const parts = interaction.customId.split('_');
    const value = parts[parts.length - 1];
    const nick = parts.slice(2, parts.length - 1).join('_');

    logger.info(`[PHASE1] Rozstrzygam konflikt dla nick="${nick}", value="${value}"`);

    // Rozstrzygnij konflikt
    phaseService.resolveConflict(session, nick, parseInt(value) || 0);

    logger.info(`[PHASE1] Rozstrzygnięto konfliktów: ${session.resolvedConflicts.size}/${session.conflicts.length}`);

    // Sprawdź czy są jeszcze konflikty
    const nextConflict = phaseService.getNextUnresolvedConflict(session);

    if (nextConflict) {
        // Pokaż następny konflikt
        const currentIndex = session.resolvedConflicts.size + 1;
        const totalConflicts = session.conflicts.length;

        logger.info(`[PHASE1] Następny konflikt: nick="${nextConflict.nick}", index=${currentIndex}/${totalConflicts}`);

        const conflictEmbed = phaseService.createConflictEmbed(nextConflict, currentIndex, totalConflicts, 1);
        await interaction.update({
            embeds: [conflictEmbed.embed],
            components: [conflictEmbed.row]
        });
    } else {
        logger.info(`[PHASE1] Wszystkie konflikty rozstrzygnięte!`);
        // Wszystkie konflikty rozstrzygnięte - pokaż finalne podsumowanie
        await interaction.update({
            content: '🔄 Przygotowuję podsumowanie...',
            embeds: [],
            components: []
        });

        await showPhase1FinalSummary(interaction, session, phaseService);
    }
}

async function handlePhase1ManualInputButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może rozstrzygać konflikty.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    // Wyciągnij nick z customId
    // Format: phase1_manual_{nick}
    const parts = interaction.customId.split('_');
    const nick = parts.slice(2).join('_');

    logger.info(`[PHASE1] Otwieranie modala ręcznego wpisu dla nick="${nick}"`);

    // Stwórz modal do wpisania wyniku
    const modal = new ModalBuilder()
        .setCustomId(`phase1_manual_modal_${nick}`)
        .setTitle(`Wpisz wynik dla: ${nick}`);

    const scoreInput = new TextInputBuilder()
        .setCustomId('manual_score')
        .setLabel('Wynik')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz liczbę (np. 1234)')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    const actionRow = new ActionRowBuilder().addComponents(scoreInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

async function handlePhase1ManualModalSubmit(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Wyciągnij nick z customId
    // Format: phase1_manual_modal_{nick}
    const parts = interaction.customId.split('_');
    const nick = parts.slice(3).join('_');

    // Pobierz wartość z modala
    const scoreValue = interaction.fields.getTextInputValue('manual_score');
    const score = parseInt(scoreValue);

    if (isNaN(score) || score < 0) {
        await interaction.reply({
            content: '❌ Nieprawidłowa wartość. Wpisz liczbę całkowitą nieujemną.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    logger.info(`[PHASE1] Ręczny wpis dla nick="${nick}", value="${score}"`);

    // Rozstrzygnij konflikt
    phaseService.resolveConflict(session, nick, score);

    logger.info(`[PHASE1] Rozstrzygnięto konfliktów: ${session.resolvedConflicts.size}/${session.conflicts.length}`);

    // Sprawdź czy są jeszcze konflikty
    const nextConflict = phaseService.getNextUnresolvedConflict(session);

    if (nextConflict) {
        // Pokaż następny konflikt
        const currentIndex = session.resolvedConflicts.size + 1;
        const totalConflicts = session.conflicts.length;

        logger.info(`[PHASE1] Następny konflikt: nick="${nextConflict.nick}", index=${currentIndex}/${totalConflicts}`);

        const conflictEmbed = phaseService.createConflictEmbed(nextConflict, currentIndex, totalConflicts, 1);
        await interaction.update({
            embeds: [conflictEmbed.embed],
            components: [conflictEmbed.row]
        });
    } else {
        logger.info(`[PHASE1] Wszystkie konflikty rozstrzygnięte!`);
        // Wszystkie konflikty rozstrzygnięte - pokaż finalne podsumowanie
        await interaction.update({
            content: '🔄 Przygotowuję podsumowanie...',
            embeds: [],
            components: []
        });

        await showPhase1FinalSummary(interaction, session, phaseService);
    }
}

async function handlePhase1FinalConfirmButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może ją zatwierdzić.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    if (interaction.customId === 'phase1_cancel_save') {
        // Anuluj - usuń pliki temp i zakończ sesję OCR (cleanupSession wywołuje endOCRSession)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie zapisu Phase1)`);

        await interaction.update({
            content: '❌ Operacja anulowana. Dane nie zostały zapisane.',
            embeds: [],
            components: []
        });
        return;
    }

    // Zatwierdź - zapisz do bazy
    // Użyj deferUpdate dla przycisku, a następnie followUp zamiast editReply
    await interaction.deferUpdate();

    try {
        const finalResults = phaseService.getFinalResults(session);
        const savedCount = await phaseService.saveFinalResults(session, finalResults, interaction.guild, interaction.user.id);

        const weekInfo = phaseService.getCurrentWeekInfo();
        const stats = phaseService.calculateStatistics(finalResults);
        const clanName = sharedState.config.roleDisplayNames[session.clan] || session.clan;

        // Zbierz nicki graczy z wynikiem 0
        const playersWithZero = [];
        for (const [nick, score] of finalResults) {
            if (score === 0) {
                playersWithZero.push(nick);
            }
        }

        // Publiczny raport (wszystko widoczne dla wszystkich)
        const publicEmbed = new EmbedBuilder()
            .setTitle(`Faza 1 | Tydzień ${weekInfo.weekNumber}/${weekInfo.year}`)
            .setDescription(`Dane zostały zaktualizowane <a:PepeCoding:1278014173321625819>`)
            .setColor('#00FF00')
            .addFields(
                { name: '👥 Unikalnych graczy', value: stats.uniqueNicks.toString(), inline: true },
                { name: '📈 Wynik > 0', value: `${stats.aboveZero} osób`, inline: true },
                { name: '⭕ Wynik = 0', value: `${stats.zeroCount} osób`, inline: true },
                { name: '🏆 Suma TOP30', value: `${stats.top30Sum.toLocaleString('pl-PL')} pkt`, inline: false },
                { name: '🎯 Klan', value: clanName, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Zapisane przez ${interaction.user.tag}` });

        // Dodaj listę graczy z zerem jeśli są
        if (playersWithZero.length > 0) {
            const zeroList = playersWithZero.join(', ');
            publicEmbed.addFields({ name: '📋 Gracze z wynikiem 0', value: zeroList, inline: false });
        }

        // Usuń TYLKO pliki temp (NIE całą sesję - to zrobimy po pokazaniu progress bara)
        await phaseService.cleanupSessionFiles(session.sessionId);

        logger.info(`[PHASE1] ✅ Dane zapisane dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}`);

        // Wyślij powiadomienie na kanał ostrzeżeń
        try {
            const clanRoleId = sharedState.config.targetRoles[session.clan];
            const warningChannelId = sharedState.config.warningChannels[clanRoleId];

            if (warningChannelId) {
                const warningChannel = await interaction.client.channels.fetch(warningChannelId);
                if (warningChannel) {
                    await warningChannel.send(`## Faza 1 | Tydzień ${weekInfo.weekNumber}/${weekInfo.year}\n## Dane zostały zaktualizowane <a:PepeCoding:1278014173321625819>`);
                    logger.info(`[PHASE1] 📢 Wysłano powiadomienie na kanał ostrzeżeń ${warningChannelId}`);
                }
            }
        } catch (error) {
            logger.error(`[PHASE1] ⚠️ Błąd wysyłania powiadomienia na kanał ostrzeżeń: ${error.message}`);
        }

        // Pokaż embed z progress barem (animacja 5 sekund)
        for (let i = 5; i >= 0; i--) {
            const progress = ((5 - i) / 5) * 100;
            const filledBars = Math.floor(progress / 10);
            const emptyBars = 10 - filledBars;
            const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

            // Skopiuj embed i dodaj pole z progress barem
            const embedWithProgress = EmbedBuilder.from(publicEmbed);
            embedWithProgress.addFields({
                name: '⏳ Czyszczenie kanału',
                value: `${progressBar} ${Math.floor(progress)}%\nZa ${i} sekund...`,
                inline: false
            });

            await interaction.editReply({
                content: null,
                embeds: [embedWithProgress],
                components: []
            });

            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Zaktualizuj embed bez progress bara (końcowa wiadomość)
        await interaction.editReply({
            content: null,
            embeds: [publicEmbed],
            components: []
        });

        // TERAZ dopiero wyczyść całą sesję (to wywołuje endOCRSession i czyści kanał)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (sukces Phase1)`);

    } catch (error) {
        logger.error('[PHASE1] ❌ Błąd zapisu danych:', error);

        // Wyczyść sesję w przypadku błędu (to wywołuje endOCRSession)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd zapisu Phase1)`);

        // Spróbuj odpowiedzieć użytkownikowi (może się nie udać jeśli interaction expired)
        try {
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas zapisu danych do bazy.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.warn('[PHASE1] ⚠️ Nie udało się zaktualizować wiadomości (interaction expired)');
        }
    }
}

async function showPhase1FinalSummary(interaction, session, phaseService) {
    const finalResults = phaseService.getFinalResults(session);
    const stats = phaseService.calculateStatistics(finalResults);
    const weekInfo = phaseService.getCurrentWeekInfo();

    // Przygotuj listę graczy z paskami postępu
    const players = Array.from(finalResults.entries()).map(([nick, score]) => ({
        displayName: nick,
        score: score,
        userId: null // W phase1 nie mamy userId w finalResults
    }));

    const sortedPlayers = players.sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 10;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        return `${progressBar} ${position}. ${player.displayName} - ${player.score.toLocaleString('pl-PL')}`;
    }).join('\n');

    const summaryEmbed = phaseService.createFinalSummaryEmbed(stats, weekInfo, session.clan, 1);

    // Dodaj listę graczy do description
    const clanName = phaseService.config.roleDisplayNames[session.clan] || session.clan;
    summaryEmbed.embed.setDescription(
        `**Klan:** ${clanName}\n**Tydzień:** ${weekInfo.weekNumber}/${weekInfo.year}\n**TOP30:** ${stats.top30Sum.toLocaleString('pl-PL')} pkt\n\n${resultsText}\n\n✅ Przeanalizowano wszystkie zdjęcia i rozstrzygnięto konflikty.\n\n**⚠️ Sprawdź dokładnie czy ostateczny wynik odczytu zgadza się z rzeczywistą ilością zdobytych punktów w grze.**\n**Zaakceptuj wynik tylko wtedy, gdy wszystko się zgadza!**`
    );

    session.stage = 'final_confirmation';

    await interaction.editReply({
        embeds: [summaryEmbed.embed],
        components: [summaryEmbed.row]
    });
}

// =============== PHASE 2 HANDLERS ===============

async function handlePhase2Command(interaction, sharedState) {
    const { config, phaseService, databaseService, ocrService } = sharedState;
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const commandName = '/faza2';

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // ===== SPRAWDZENIE KOLEJKI OCR (przed deferReply) =====
    // Sprawdź czy użytkownik ma rezerwację
    const hasReservation = ocrService.hasReservation(guildId, userId);

    // Sprawdź czy ktoś inny używa OCR
    const isOCRActive = ocrService.isOCRActive(guildId);

    // Sprawdź czy kolejka jest pusta
    const isQueueEmpty = ocrService.isQueueEmpty(guildId);

    // Określ czy użytkownik będzie dodany do kolejki
    const willBeQueued = !hasReservation && (isOCRActive || !isQueueEmpty);

    // Defer reply z odpowiednim ephemeral flag
    // TYLKO powiadomienie o kolejce jest ephemeral, embeddy analizy OCR są publiczne
    await interaction.deferReply({ ephemeral: willBeQueued });

    try {
        // Wykryj klan użytkownika
        const targetRoleIds = Object.entries(config.targetRoles);
        let userClan = null;

        for (const [clanKey, roleId] of targetRoleIds) {
            if (interaction.member.roles.cache.has(roleId)) {
                userClan = clanKey;
                logger.info(`[PHASE2] 🎯 Wykryto klan użytkownika: ${clanKey} (${config.roleDisplayNames[clanKey]})`);
                break;
            }
        }

        if (!userClan) {
            await interaction.editReply({
                content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról: ' +
                    Object.values(config.roleDisplayNames).join(', ')
            });
            return;
        }

        // Jeśli nie ma rezerwacji I (ktoś używa OCR LUB kolejka nie jest pusta) -> dodaj do kolejki
        if (willBeQueued) {
            // Ktoś inny używa OCR lub jest kolejka, dodaj do kolejki
            const { position } = await ocrService.addToOCRQueue(guildId, userId, commandName);

            const queueEmbed = new EmbedBuilder()
                .setTitle('⏳ Kolejka OCR')
                .setDescription(`System OCR jest obecnie zajęty przez innego użytkownika.\n\n` +
                               `Zostałeś dodany do kolejki na pozycji **#${position}**.\n\n` +
                               `👋 Otrzymasz powiadomienia na kanale kolejki co 30 sekund, gdy będzie Twoja kolej (masz 3 minuty na użycie komendy).\n\n` +
                               `⚠️ Jeśli nie użyjesz komendy w ciągu 3 minut od pierwszego powiadomienia, Twoja rezerwacja wygaśnie.`)
                .setColor('#ffa500')
                .setTimestamp()
                .setFooter({ text: `Komenda: ${commandName} | Pozycja w kolejce: ${position}` });

            await interaction.editReply({
                embeds: [queueEmbed]
            });
            return;
        }

        // Rozpocznij sesję OCR
        await ocrService.startOCRSession(guildId, userId, commandName);
        logger.info(`[OCR-QUEUE] 🟢 ${interaction.user.tag} rozpoczyna sesję OCR (${commandName})`);

        // Pobierz timestamp wygaśnięcia OCR z kolejki
        const activeOCR = ocrService.activeProcessing.get(guildId);
        const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

        // Sprawdź czy dane dla tego tygodnia i klanu już istnieją
        const weekInfo = phaseService.getCurrentWeekInfo();
        const existingData = await databaseService.checkPhase2DataExists(
            interaction.guild.id,
            weekInfo.weekNumber,
            weekInfo.year,
            userClan
        );

        if (existingData.exists) {
            // Pokaż ostrzeżenie z przyciskami
            const warningEmbed = await phaseService.createOverwriteWarningEmbed(
                interaction.guild.id,
                weekInfo,
                userClan,
                2,
                interaction.guild
            );

            if (warningEmbed) {
                await interaction.editReply({
                    embeds: [warningEmbed.embed],
                    components: [warningEmbed.row]
                });
                return;
            }
        }

        // Utwórz sesję dla fazy 2
        const sessionId = phaseService.createSession(
            interaction.user.id,
            interaction.guild.id,
            interaction.channelId,
            2, // phase 2
            ocrExpiresAt // timestamp OCR
        );

        const session = phaseService.getSession(sessionId);
        session.publicInteraction = interaction;
        session.clan = userClan;

        // Pokaż embed z prośbą o zdjęcia dla rundy 1 (PUBLICZNY)
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, 1);
        await interaction.editReply({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        logger.info(`[PHASE2] ✅ Sesja utworzona, czekam na zdjęcia z rundy 1/3 od ${interaction.user.tag}`);

    } catch (error) {
        logger.info(`[PHASE2] ❌ Błąd komendy /faza2:`, error);

        // Zakończ sesję OCR w przypadku błędu
        await ocrService.endOCRSession(guildId, userId, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd Phase2)`);

        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas uruchamiania komendy.'
        });
    }
}

async function handlePhase2OverwriteButton(interaction, sharedState) {
    const { phaseService, config, ocrService } = sharedState;

    if (interaction.customId === 'phase2_overwrite_no') {
        await ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie Phase2)`);

        // Próbuj zaktualizować wiadomość (może być już usunięta przez cleanup)
        try {
            await interaction.update({
                content: '❌ Operacja anulowana.',
                embeds: [],
                components: []
            });
        } catch (updateError) {
            // Wiadomość została już usunięta przez cleanupQueueChannelMessages - to OK
            logger.info(`[PHASE2] ℹ️ Nie można zaktualizować wiadomości (prawdopodobnie już usunięta): ${updateError.message}`);
        }
        return;
    }

    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.update({
            content: '❌ Nie wykryto Twojego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    // Sesja OCR już aktywna (została rozpoczęta w handlePhase2Command)

    // Pobierz timestamp wygaśnięcia OCR z kolejki
    const activeOCR = ocrService.activeProcessing.get(interaction.guild.id);
    const ocrExpiresAt = activeOCR ? activeOCR.expiresAt : null;

    const sessionId = phaseService.createSession(
        interaction.user.id,
        interaction.guild.id,
        interaction.channelId,
        2, // phase 2
        ocrExpiresAt // timestamp OCR
    );

    const session = phaseService.getSession(sessionId);
    session.publicInteraction = interaction;
    session.clan = userClan;

    const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, 1);
    await interaction.update({
        embeds: [awaitingEmbed.embed],
        components: [awaitingEmbed.row]
    });

    logger.info(`[PHASE2] ✅ Sesja utworzona (nadpisywanie), czekam na zdjęcia od ${interaction.user.tag}`);
}

async function handlePhase2CompleteButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    if (interaction.customId === 'phase2_cancel_session') {
        // WAŻNE: Najpierw zaktualizuj wiadomość, potem usuń sesję
        await interaction.update({
            content: '❌ Sesja anulowana.',
            embeds: [],
            components: []
        });

        // Anuluj sesję (cleanupSession wywołuje endOCRSession gdy to bezpieczne)
        await phaseService.cleanupSession(session.sessionId);

        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie Phase2)`);
        logger.info(`[PHASE2] ❌ Sesja anulowana przez użytkownika: ${interaction.user.tag}`);
        return;
    }

    if (interaction.customId === 'phase2_complete_no') {
        session.stage = 'awaiting_images';
        phaseService.refreshSessionTimeout(session.sessionId);

        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, session.currentRound);
        await interaction.update({
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });
        return;
    }

    // Jeśli to przycisk rozwiązywania konfliktu
    if (interaction.customId.startsWith('phase2_resolve_')) {
        // Zatrzymaj ghost ping - użytkownik kliknął przycisk
        stopGhostPing(session);

        const parts = interaction.customId.split('_');
        const nick = parts[2];
        const chosenValue = parseInt(parts[3]);

        logger.info(`[PHASE2] Rozstrzygam konflikt dla nick="${nick}", value="${chosenValue}"`);

        const conflict = phaseService.getNextUnresolvedConflict(session);

        if (conflict) {
            phaseService.resolveConflict(session, conflict.nick, chosenValue);
            const nextConflict = phaseService.getNextUnresolvedConflict(session);

            if (nextConflict) {
                const conflictEmbed = phaseService.createConflictEmbed(
                    nextConflict,
                    session.resolvedConflicts.size + 1,
                    session.conflicts.length,
                    2
                );
                await interaction.update({
                    embeds: [conflictEmbed.embed],
                    components: [conflictEmbed.row]
                });
                return;
            }
        }

        // Wszystkie konflikty rozwiązane - pokaż podsumowanie rundy
        logger.info(`[PHASE2] ✅ Wszystkie konflikty rozwiązane!`);

        // Pokaż podsumowanie rundy (działa dla rund 1, 2 i 3)
        await showPhase2RoundSummary(interaction, session, phaseService);
        return;
    }

    // Przycisk "Tak, gotowe" po dodaniu zdjęć
    await interaction.update({
        content: '🔄 Analizuję wyniki...',
        embeds: [],
        components: []
    });

    try {
        const aggregated = phaseService.aggregateResults(session);
        const conflicts = phaseService.identifyConflicts(session);

        if (conflicts.length > 0) {
            session.stage = 'resolving_conflicts';
            session.currentConflictIndex = 0;
            const conflictEmbed = phaseService.createConflictEmbed(conflicts[0], 0, conflicts.length, 2);
            await interaction.editReply({
                embeds: [conflictEmbed.embed],
                components: [conflictEmbed.row]
            });
        } else {
            // Brak konfliktów - pokaż podsumowanie rundy
            await showPhase2RoundSummary(interaction, session, phaseService);
        }
    } catch (error) {
        logger.error('[PHASE2] ❌ Błąd analizy:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas analizy wyników.'
        });
    }
}

async function handlePhase2FinalConfirmButton(interaction, sharedState) {
    const { phaseService, databaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    if (interaction.customId === 'phase2_cancel_save') {
        // Anuluj zapis i zakończ sesję OCR (cleanupSession wywołuje endOCRSession)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (anulowanie zapisu Phase2)`);

        await interaction.update({
            content: '❌ Anulowano zapis danych.',
            embeds: [],
            components: []
        });
        return;
    }

    // Użyj deferUpdate dla przycisku, a następnie editReply
    await interaction.deferUpdate();

    try {
        // Wyniki wszystkich rund są już w roundsData (dodane po rozwiązaniu konfliktów)
        logger.info(`[PHASE2] 📊 Sumowanie wyników z ${session.roundsData.length} rund...`);
        const summedResults = phaseService.sumPhase2Results(session);
        const weekInfo = phaseService.getCurrentWeekInfo();

        // Przygotuj dane z każdej rundy
        const roundsData = [];
        for (const roundData of session.roundsData) {
            const roundPlayers = [];
            for (const [nick, score] of roundData.results) {
                const member = interaction.guild.members.cache.find(m =>
                    m.displayName.toLowerCase() === nick.toLowerCase() ||
                    m.user.username.toLowerCase() === nick.toLowerCase()
                );

                if (member) {
                    roundPlayers.push({
                        userId: member.id,
                        displayName: member.displayName,
                        score: score
                    });
                }
            }
            roundsData.push({
                round: roundData.round,
                players: roundPlayers
            });
        }

        // Przygotuj zsumowane wyniki
        const summaryPlayers = [];
        for (const [nick, totalScore] of summedResults) {
            const member = interaction.guild.members.cache.find(m =>
                m.displayName.toLowerCase() === nick.toLowerCase() ||
                m.user.username.toLowerCase() === nick.toLowerCase()
            );

            if (member) {
                summaryPlayers.push({
                    userId: member.id,
                    displayName: member.displayName,
                    score: totalScore
                });
            }
        }

        // Zapisz wszystko do bazy
        await databaseService.savePhase2Results(
            session.guildId,
            weekInfo.weekNumber,
            weekInfo.year,
            session.clan,
            roundsData,
            summaryPlayers,
            interaction.user.id
        );

        const stats = phaseService.calculateStatistics(summedResults);
        const clanName = sharedState.config.roleDisplayNames[session.clan] || session.clan;

        // Oblicz sumę zer z wszystkich 3 rund
        let totalZeroCount = 0;
        for (const roundData of session.roundsData) {
            for (const [nick, score] of roundData.results) {
                if (score === 0) {
                    totalZeroCount++;
                }
            }
        }

        // Usuń TYLKO pliki temp (NIE całą sesję - to zrobimy po pokazaniu progress bara)
        await phaseService.cleanupSessionFiles(session.sessionId);

        logger.info(`[PHASE2] ✅ Dane zapisane dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}`);

        // Wyślij powiadomienie na kanał ostrzeżeń
        try {
            const clanRoleId = sharedState.config.targetRoles[session.clan];
            const warningChannelId = sharedState.config.warningChannels[clanRoleId];

            if (warningChannelId) {
                const warningChannel = await interaction.client.channels.fetch(warningChannelId);
                if (warningChannel) {
                    await warningChannel.send(`## Faza 2 | Tydzień ${weekInfo.weekNumber}/${weekInfo.year}\n## Dane zostały zaktualizowane <a:PepeCoding:1278014173321625819>`);
                    logger.info(`[PHASE2] 📢 Wysłano powiadomienie na kanał ostrzeżeń ${warningChannelId}`);
                }
            }
        } catch (error) {
            logger.error(`[PHASE2] ⚠️ Błąd wysyłania powiadomienia na kanał ostrzeżeń: ${error.message}`);
        }

        const publicEmbed = new EmbedBuilder()
            .setTitle(`Faza 2 | Tydzień ${weekInfo.weekNumber}/${weekInfo.year}`)
            .setDescription(`Dane zostały zaktualizowane <a:PepeCoding:1278014173321625819>`)
            .setColor('#00FF00')
            .addFields(
                { name: '⭕ Wynik = 0 (suma z 3 rund)', value: `${totalZeroCount} wystąpień`, inline: false },
                { name: '🎯 Klan', value: clanName, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: `Zapisane przez ${interaction.user.tag}` });

        // Pokaż embed z progress barem (animacja 5 sekund)
        for (let i = 5; i >= 0; i--) {
            const progress = ((5 - i) / 5) * 100;
            const filledBars = Math.floor(progress / 10);
            const emptyBars = 10 - filledBars;
            const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

            // Skopiuj embed i dodaj pole z progress barem
            const embedWithProgress = EmbedBuilder.from(publicEmbed);
            embedWithProgress.addFields({
                name: '⏳ Czyszczenie kanału',
                value: `${progressBar} ${Math.floor(progress)}%\nZa ${i} sekund...`,
                inline: false
            });

            await interaction.editReply({
                content: null,
                embeds: [embedWithProgress],
                components: []
            });

            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Zaktualizuj embed bez progress bara (końcowa wiadomość)
        await interaction.editReply({
            content: null,
            embeds: [publicEmbed],
            components: []
        });

        // TERAZ dopiero wyczyść całą sesję (to wywołuje endOCRSession i czyści kanał)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (sukces Phase2)`);

    } catch (error) {
        logger.error('[PHASE2] ❌ Błąd zapisu:', error);

        // Wyczyść sesję w przypadku błędu (to wywołuje endOCRSession)
        await phaseService.cleanupSession(session.sessionId);
        logger.info(`[OCR-QUEUE] 🔴 ${interaction.user.tag} zakończył sesję OCR (błąd zapisu Phase2)`);

        // Spróbuj odpowiedzieć użytkownikowi (może się nie udać jeśli interaction expired)
        try {
            await interaction.editReply({
                content: '❌ Wystąpił błąd podczas zapisywania danych.',
                embeds: [],
                components: []
            });
        } catch (replyError) {
            logger.warn('[PHASE2] ⚠️ Nie udało się zaktualizować wiadomości (interaction expired)');
        }
    }
}

async function handlePhase2ManualInputButton(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Tylko osoba, która uruchomiła komendę może rozstrzygać konflikty.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    // Wyciągnij nick z customId
    // Format: phase2_manual_{nick}
    const parts = interaction.customId.split('_');
    const nick = parts.slice(2).join('_');

    logger.info(`[PHASE2] Otwieranie modala ręcznego wpisu dla nick="${nick}"`);

    // Stwórz modal do wpisania wyniku
    const modal = new ModalBuilder()
        .setCustomId(`phase2_manual_modal_${nick}`)
        .setTitle(`Wpisz wynik dla: ${nick}`);

    const scoreInput = new TextInputBuilder()
        .setCustomId('manual_score')
        .setLabel('Wynik')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz liczbę (np. 1234)')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(10);

    const actionRow = new ActionRowBuilder().addComponents(scoreInput);
    modal.addComponents(actionRow);

    await interaction.showModal(modal);
}

async function handlePhase2ManualModalSubmit(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie istnieje.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Wyciągnij nick z customId
    // Format: phase2_manual_modal_{nick}
    const parts = interaction.customId.split('_');
    const nick = parts.slice(3).join('_');

    // Pobierz wartość z modala
    const scoreValue = interaction.fields.getTextInputValue('manual_score');
    const score = parseInt(scoreValue);

    if (isNaN(score) || score < 0) {
        await interaction.reply({
            content: '❌ Nieprawidłowa wartość. Wpisz liczbę całkowitą nieujemną.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    logger.info(`[PHASE2] Ręczny wpis dla nick="${nick}", value="${score}"`);

    // Rozstrzygnij konflikt
    const conflict = phaseService.getNextUnresolvedConflict(session);
    if (conflict) {
        phaseService.resolveConflict(session, conflict.nick, score);
    }

    logger.info(`[PHASE2] Rozstrzygnięto konfliktów: ${session.resolvedConflicts.size}/${session.conflicts.length}`);

    // Sprawdź czy są jeszcze konflikty
    const nextConflict = phaseService.getNextUnresolvedConflict(session);

    if (nextConflict) {
        // Pokaż następny konflikt
        const conflictEmbed = phaseService.createConflictEmbed(
            nextConflict,
            session.resolvedConflicts.size + 1,
            session.conflicts.length,
            2
        );
        await interaction.update({
            embeds: [conflictEmbed.embed],
            components: [conflictEmbed.row]
        });
    } else {
        // Wszystkie konflikty rozwiązane - pokaż podsumowanie rundy
        logger.info(`[PHASE2] ✅ Wszystkie konflikty rozwiązane!`);
        await showPhase2RoundSummary(interaction, session, phaseService);
    }
}

async function showPhase2FinalSummaryNewMessage(channel, session, phaseService, ocrService) {
    logger.info(`[PHASE2] 📋 Tworzenie finalnego podsumowania ze wszystkich 3 rund...`);

    try {
        logger.info(`[PHASE2] 🔢 Rozpoczynam sumowanie wyników z 3 rund...`);
        const summedResults = phaseService.sumPhase2Results(session);

        logger.info(`[PHASE2] 📊 Obliczam statystyki...`);
        const stats = phaseService.calculateStatistics(summedResults);

        // Oblicz unikalnych użytkowników ze wszystkich 3 rund
        const allUniqueNicks = new Set();
        for (const roundData of session.roundsData) {
            for (const [nick] of roundData.results) {
                allUniqueNicks.add(nick);
            }
        }
        const totalUniqueUsers = allUniqueNicks.size;

        // Oblicz sumę zer z wszystkich 3 rund
        let totalZeroCount = 0;
        for (const roundData of session.roundsData) {
            for (const [nick, score] of roundData.results) {
                if (score === 0) {
                    totalZeroCount++;
                }
            }
        }

        // Oblicz sumę TOP30 z 3 rund
        let top30Sum = 0;
        for (const roundData of session.roundsData) {
            if (roundData.results) {
                const roundPlayers = Array.from(roundData.results.entries())
                    .map(([nick, score]) => ({ nick, score }))
                    .sort((a, b) => b.score - a.score);

                const roundTop30 = roundPlayers.slice(0, 30);
                const roundTop30Sum = roundTop30.reduce((sum, player) => sum + player.score, 0);
                top30Sum += roundTop30Sum;
            }
        }

        logger.info(`[PHASE2] 🏆 Statystyki finalne - TOP30: ${top30Sum}, Unikalni: ${totalUniqueUsers}, Zera: ${totalZeroCount}`);

        const weekInfo = phaseService.getCurrentWeekInfo();
        const clanName = phaseService.config.roleDisplayNames[session.clan] || session.clan;

        // Przygotuj opis z najważniejszymi informacjami
        const description =
            `**Klan:** ${clanName}\n` +
            `**Tydzień:** ${weekInfo.weekNumber}/${weekInfo.year}\n\n` +
            `📊 **Suma TOP30 z 3 rund:** ${top30Sum.toLocaleString('pl-PL')} pkt\n` +
            `👥 **Unikalnych użytkowników:** ${totalUniqueUsers}\n` +
            `🥚 **Wykrytych zer (łącznie):** ${totalZeroCount}\n\n` +
            `✅ Przeanalizowano wszystkie 3 rundy.\n\n` +
            `**⚠️ Sprawdź dokładnie czy ostateczny wynik odczytu zgadza się z rzeczywistą ilością zdobytych punktów w grze.**\n` +
            `**Zaakceptuj wynik tylko wtedy, gdy wszystko się zgadza!**`;

        const embed = new EmbedBuilder()
            .setTitle('📊 Faza 2 - Finalne podsumowanie (Rundy 1-3)')
            .setDescription(description)
            .setColor('#00FF00')
            .setTimestamp()
            .setFooter({ text: 'Czy zatwierdzić i zapisać dane?' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('phase2_confirm_save')
                    .setLabel('🟢 Zatwierdź')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('phase2_cancel_save')
                    .setLabel('🔴 Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        // Wyślij NOWĄ wiadomość
        const newMessage = await channel.send({
            content: '',
            embeds: [embed],
            components: [row]
        });

        // Zaktualizuj session.publicInteraction na nową wiadomość
        session.publicInteraction = newMessage;
        session.stage = 'final_confirmation';

        logger.info(`[PHASE2] ✅ Finalne podsumowanie wysłane jako nowa wiadomość: ${newMessage.id}`);

    } catch (error) {
        logger.error(`[PHASE2] ❌ Błąd w showPhase2FinalSummaryNewMessage:`, error);
        logger.error(`[PHASE2] ❌ Error stack:`, error.stack);
        throw error;
    }
}

async function showPhase2FinalSummary(interaction, session, phaseService) {
    logger.info(`[PHASE2] 📋 Tworzenie finalnego podsumowania...`);

    try {
        logger.info(`[PHASE2] 🔢 Rozpoczynam sumowanie wyników...`);
        const summedResults = phaseService.sumPhase2Results(session);

        logger.info(`[PHASE2] 📊 Obliczam statystyki...`);
        const stats = phaseService.calculateStatistics(summedResults);

        // Oblicz sumę zer z wszystkich 3 rund
        let totalZeroCount = 0;
        for (const roundData of session.roundsData) {
            for (const [nick, score] of roundData.results) {
                if (score === 0) {
                    totalZeroCount++;
                }
            }
        }
        stats.totalZeroCount = totalZeroCount;

        // Oblicz sumę TOP30 z 3 rund (tak jak w /wyniki w zakładce "Suma Faza2")
        let top30Sum = 0;
        for (const roundData of session.roundsData) {
            if (roundData.results) {
                // Konwertuj Map do tablicy [{nick, score}]
                const roundPlayers = Array.from(roundData.results.entries())
                    .map(([nick, score]) => ({ nick, score }))
                    .sort((a, b) => b.score - a.score);

                const roundTop30 = roundPlayers.slice(0, 30);
                const roundTop30Sum = roundTop30.reduce((sum, player) => sum + player.score, 0);
                top30Sum += roundTop30Sum;
            }
        }
        stats.top30Sum = top30Sum;
        logger.info(`[PHASE2] 🏆 Suma TOP30 z 3 rund: ${top30Sum}`);

        logger.info(`[PHASE2] 📅 Pobieram informacje o tygodniu...`);
        const weekInfo = phaseService.getCurrentWeekInfo();

        logger.info(`[PHASE2] 🎨 Tworzę embed podsumowania...`);
        const summaryEmbed = phaseService.createFinalSummaryEmbed(stats, weekInfo, session.clan, 2);

        session.stage = 'final_confirmation';

        logger.info(`[PHASE2] 📤 Wysyłam podsumowanie do użytkownika...`);
        logger.info(`[PHASE2] 🔍 Stan interakcji - deferred: ${interaction.deferred}, replied: ${interaction.replied}`);

        try {
            // Po update() trzeba użyć followUp() zamiast editReply()
            if (interaction.replied) {
                await interaction.followUp({
                    embeds: [summaryEmbed.embed],
                    components: [summaryEmbed.row]
                });
            } else {
                await interaction.editReply({
                    embeds: [summaryEmbed.embed],
                    components: [summaryEmbed.row]
                });
            }
            logger.info(`[PHASE2] ✅ Podsumowanie wysłane pomyślnie`);
        } catch (replyError) {
            logger.error(`[PHASE2] ❌ Błąd podczas wysyłania odpowiedzi:`, replyError);
            logger.error(`[PHASE2] ❌ Reply error message:`, replyError?.message);
            logger.error(`[PHASE2] ❌ Reply error code:`, replyError?.code);
            throw replyError;
        }
    } catch (error) {
        logger.error(`[PHASE2] ❌ Błąd w showPhase2FinalSummary:`, error);
        logger.error(`[PHASE2] ❌ Error stack:`, error.stack);
        throw error;
    }
}

async function handlePhase2RoundContinue(interaction, sharedState) {
    const { phaseService, ocrService } = sharedState;

    const session = phaseService.getSessionByUserId(interaction.user.id);

    if (!session || session.userId !== interaction.user.id) {
        await interaction.reply({
            content: '❌ Sesja wygasła lub nie masz uprawnień.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Odśwież timeout sesji OCR
    await ocrService.refreshOCRSession(interaction.guild.id, interaction.user.id);

    // Zatrzymaj ghost ping - użytkownik kliknął przycisk
    stopGhostPing(session);

    // Sprawdź czy to była ostatnia runda
    if (session.currentRound < 3) {
        // Zapisz wyniki bieżącej rundy i przejdź do następnej
        phaseService.startNextRound(session);

        // Zaktualizuj starą wiadomość (usuń przyciski)
        await interaction.update({
            content: `✅ Runda ${session.currentRound - 1}/3 zakończona!`,
            components: []
        });

        // Wyślij NOWĄ wiadomość do kanału dla następnej rundy
        const awaitingEmbed = phaseService.createAwaitingImagesEmbed(2, session.currentRound);
        const channel = await interaction.guild.channels.fetch(session.channelId);
        const newMessage = await channel.send({
            content: '',
            embeds: [awaitingEmbed.embed],
            components: [awaitingEmbed.row]
        });

        // Zaktualizuj session.publicInteraction na nową wiadomość
        session.publicInteraction = newMessage;

        logger.info(`[PHASE2] 🔄 Przechodzę do rundy ${session.currentRound}/3 (nowa wiadomość: ${newMessage.id})`);
    } else {
        // Runda 3 - NIE przechodzimy od razu do finalnego podsumowania
        // Najpierw zapisz wyniki rundy 3 (tak jak rundy 1 i 2 w startNextRound)
        logger.info(`[PHASE2] 💾 Zapisywanie wyników rundy 3...`);
        const lastRoundData = {
            round: session.currentRound,
            results: phaseService.getFinalResults(session)
        };
        logger.info(`[PHASE2] 📊 Wyniki rundy 3: ${lastRoundData.results.size} graczy`);
        session.roundsData.push(lastRoundData);
        logger.info(`[PHASE2] ✅ Zapisano wyniki rundy ${session.currentRound}/3. Łącznie ${session.roundsData.length} rund w roundsData`);

        // Wyczyść dane aktualnej rundy (tak jak w startNextRound)
        session.processedImages = [];
        session.aggregatedResults = new Map();
        session.conflicts = [];
        session.resolvedConflicts = new Map();
        session.downloadedFiles = [];

        // Zaktualizuj starą wiadomość (usuń przyciski)
        await interaction.update({
            content: `✅ Runda 3/3 zakończona!`,
            components: []
        });

        // Wyślij NOWĄ wiadomość z finalnym podsumowaniem ze wszystkich 3 rund
        const channel = await interaction.guild.channels.fetch(session.channelId);

        try {
            await showPhase2FinalSummaryNewMessage(channel, session, phaseService, ocrService);
        } catch (error) {
            logger.error(`[PHASE2] ❌ Błąd podczas wyświetlania finalnego podsumowania:`, error);
            throw error;
        }
    }
}

async function showPhase2RoundSummary(interaction, session, phaseService) {
    logger.info(`[PHASE2] 📋 Tworzenie podsumowania rundy ${session.currentRound}...`);

    // Oblicz statystyki dla tej rundy
    const finalResults = phaseService.getFinalResults(session);
    const stats = phaseService.calculateStatistics(finalResults);

    // Przygotuj listę graczy z paskami postępu
    const players = Array.from(finalResults.entries()).map(([nick, score]) => ({
        displayName: nick,
        score: score,
        userId: null
    }));

    const sortedPlayers = players.sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 10;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        return `${progressBar} ${position}. ${player.displayName} - ${player.score.toLocaleString('pl-PL')}`;
    }).join('\n');

    const weekInfo = phaseService.getCurrentWeekInfo();
    const clanName = phaseService.config.roleDisplayNames[session.clan] || session.clan;

    const embed = new EmbedBuilder()
        .setTitle(`✅ Runda ${session.currentRound}/3 - Podsumowanie`)
        .setDescription(`**Klan:** ${clanName}\n**Tydzień:** ${weekInfo.weekNumber}/${weekInfo.year}\n**TOP30:** ${stats.top30Sum.toLocaleString('pl-PL')} pkt\n\n${resultsText}`)
        .setColor('#00FF00')
        .setFooter({ text: `Łącznie graczy: ${sortedPlayers.length}` })
        .setTimestamp();

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('phase2_round_continue')
                .setLabel(session.currentRound < 3 ? '✅ Przejdź do następnej rundy' : '✅ Pokaż finalne podsumowanie')
                .setStyle(ButtonStyle.Success)
        );

    // Użyj odpowiedniej metody w zależności od stanu interakcji
    if (interaction.replied || interaction.deferred) {
        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });
    } else {
        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    }
}

// =============== DODAJ HANDLERS ===============

async function handleDodajWeekSelect(interaction, sharedState) {
    const { config } = sharedState;
    const [prefix, phase, clan] = interaction.customId.split('|');
    const selectedWeek = interaction.values[0];

    // Jeśli Faza 2, pokaż wybór rundy
    if (phase === 'phase2') {
        const roundOptions = [
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 1')
                .setValue('round1')
                .setDescription('Dodaj do rundy 1'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 2')
                .setValue('round2')
                .setDescription('Dodaj do rundy 2'),
            new StringSelectMenuOptionBuilder()
                .setLabel('Runda 3')
                .setValue('round3')
                .setDescription('Dodaj do rundy 3')
        ];

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`dodaj_select_round|${phase}|${clan}|${selectedWeek}`)
            .setPlaceholder('Wybierz rundę')
            .addOptions(roundOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('➕ Dodaj gracza - Faza 2')
            .setDescription(`**Krok 2/3:** Wybierz rundę\n**Tydzień:** ${selectedWeek}\n**Klan:** ${config.roleDisplayNames[clan]}`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: [row]
        });
    } else {
        // Faza 1 - pokaż select menu z użytkownikami z odpowiednią rolą
        await showUserSelectMenu(interaction, sharedState, phase, clan, selectedWeek, 'none');
    }
}

async function handleDodajRoundSelect(interaction, sharedState) {
    const [prefix, phase, clan, weekNumber] = interaction.customId.split('|');
    const selectedRound = interaction.values[0];

    // Pokaż select menu z użytkownikami z odpowiednią rolą
    await showUserSelectMenu(interaction, sharedState, phase, clan, weekNumber, selectedRound);
}

async function showUserSelectMenu(interaction, sharedState, phase, clan, weekNumber, round) {
    const { config, databaseService } = sharedState;

    // Pobierz role ID dla wybranego klanu
    const clanRoleId = config.targetRoles[clan];

    if (!clanRoleId) {
        await interaction.update({
            content: '❌ Nie znaleziono roli dla tego klanu.',
            embeds: [],
            components: []
        });
        return;
    }

    // Pobierz dane z bazy dla tego tygodnia
    const [week, year] = weekNumber.split('-');
    let existingPlayerIds = new Set();

    try {
        if (phase === 'phase1') {
            const weekData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );
            if (weekData && weekData.players) {
                weekData.players.forEach(p => existingPlayerIds.add(p.userId));
            }
        } else if (phase === 'phase2') {
            const weekData = await databaseService.getPhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );
            if (weekData) {
                if (round === 'summary' && weekData.summary) {
                    weekData.summary.players.forEach(p => existingPlayerIds.add(p.userId));
                } else if (round !== 'summary' && weekData.rounds) {
                    const roundIndex = round === 'round1' ? 0 : round === 'round2' ? 1 : 2;
                    if (weekData.rounds[roundIndex]) {
                        weekData.rounds[roundIndex].players.forEach(p => existingPlayerIds.add(p.userId));
                    }
                }
            }
        }
    } catch (error) {
        logger.error('[DODAJ] Błąd pobierania istniejących graczy:', error);
    }

    // Pobierz wszystkich członków serwera z odpowiednią rolą
    await interaction.guild.members.fetch();
    const membersWithRole = interaction.guild.members.cache.filter(member =>
        member.roles.cache.has(clanRoleId) && !existingPlayerIds.has(member.id)
    );

    if (membersWithRole.size === 0) {
        await interaction.update({
            content: '❌ Nie znaleziono użytkowników do dodania. Wszyscy członkowie klanu mają już wyniki.',
            embeds: [],
            components: []
        });
        return;
    }

    // Sortuj alfabetycznie po displayName
    const sortedMembers = Array.from(membersWithRole.values())
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .slice(0, 25); // Discord limit: max 25 opcji

    // Utwórz opcje select menu
    const userOptions = sortedMembers.map(member =>
        new StringSelectMenuOptionBuilder()
            .setLabel(member.displayName)
            .setValue(member.id)
            .setDescription(`@${member.user.username}`)
    );

    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`dodaj_select_user|${phase}|${clan}|${weekNumber}|${round}`)
        .setPlaceholder('Wybierz użytkownika')
        .addOptions(userOptions);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const phaseTitle = phase === 'phase2' ? 'Faza 2' : 'Faza 1';
    const roundText = round !== 'none' && round !== 'summary'
        ? `, ${round === 'round1' ? 'Runda 1' : round === 'round2' ? 'Runda 2' : 'Runda 3'}`
        : round === 'summary' ? ', Podsumowanie' : '';
    const stepNumber = phase === 'phase2' ? '3/3' : '2/2';

    const embed = new EmbedBuilder()
        .setTitle(`➕ Dodaj gracza - ${phaseTitle}${roundText}`)
        .setDescription(`**Krok ${stepNumber}:** Wybierz użytkownika\n**Tydzień:** ${weekNumber}\n**Klan:** ${config.roleDisplayNames[clan]}\n\nDostępnych użytkowników: **${sortedMembers.length}**`)
        .setColor('#00FF00')
        .setTimestamp();

    await interaction.update({
        embeds: [embed],
        components: [row]
    });
}

async function handleDodajUserSelect(interaction, sharedState) {
    const [prefix, phase, clan, weekNumber, round] = interaction.customId.split('|');
    const selectedUserId = interaction.values[0];

    // Pobierz wybranego użytkownika
    const selectedMember = await interaction.guild.members.fetch(selectedUserId);

    if (!selectedMember) {
        await interaction.update({
            content: '❌ Nie znaleziono wybranego użytkownika.',
            embeds: [],
            components: []
        });
        return;
    }

    // Pokaż modal tylko z polem na wynik
    const modal = new ModalBuilder()
        .setCustomId(`dodaj_modal|${phase}|${clan}|${weekNumber}|${round}|${selectedUserId}`)
        .setTitle(`Dodaj wynik dla ${selectedMember.displayName}`);

    const scoreInput = new TextInputBuilder()
        .setCustomId('score')
        .setLabel('Wynik')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Wpisz wynik (liczba)')
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(scoreInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
}

async function handleDodajCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wykryj klan użytkownika
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.reply({
            content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról klanowych aby dodawać wyniki.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const selectedPhase = interaction.options.getString('faza');

    try {
        const clanName = config.roleDisplayNames[userClan];

        // Pobierz dostępne tygodnie dla tego klanu
        const availableWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
        const weeksForClan = availableWeeks.filter(week => week.clans.includes(userClan));

        if (weeksForClan.length === 0) {
            await interaction.reply({
                content: `❌ Brak zapisanych wyników dla klanu ${clanName}. Najpierw użyj \`/faza1\` lub \`/faza2\` aby dodać wyniki.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Twórz select menu z tygodniami
        const weekOptions = weeksForClan.slice(0, 25).map(week => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                .setValue(`${week.weekNumber}-${week.year}`)
                .setDescription(`${week.clans.map(c => config.roleDisplayNames[c]).join(', ')}`);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`dodaj_select_week|${selectedPhase}|${userClan}`)
            .setPlaceholder('Wybierz tydzień')
            .addOptions(weekOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const totalSteps = selectedPhase === 'phase2' ? '3' : '2';
        const embed = new EmbedBuilder()
            .setTitle(`➕ Dodaj gracza - ${phaseTitle}`)
            .setDescription(`**Krok 1/${totalSteps}:** Wybierz tydzień\n**Klan:** ${clanName}`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[DODAJ] ❌ Błąd komendy /dodaj:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas inicjalizacji komendy.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleImgCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    try {
        // Krok 1: Wybór klanu
        const clanOptions = Object.entries(config.targetRoles).map(([clanKey, roleId]) => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(config.roleDisplayNames[clanKey])
                .setValue(clanKey);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('img_select_clan')
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📷 Dodaj zdjęcie')
            .setDescription('**Krok 1/3:** Wybierz klan, dla którego chcesz dodać zdjęcie:')
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[IMG] ❌ Błąd komendy /img:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas inicjalizacji komendy.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleImgClanSelect(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    await interaction.deferUpdate();

    try {
        const selectedClan = interaction.values[0];
        const clanName = config.roleDisplayNames[selectedClan];

        // Pobierz dostępne tygodnie z obu faz dla tego klanu
        const availableWeeksPhase1 = await databaseService.getAvailableWeeks(interaction.guild.id);
        const availableWeeksPhase2 = await databaseService.getAvailableWeeksPhase2(interaction.guild.id);

        const weeksForClanPhase1 = availableWeeksPhase1.filter(week => week.clans.includes(selectedClan));
        const weeksForClanPhase2 = availableWeeksPhase2.filter(week => week.clans.includes(selectedClan));

        // Połącz tygodnie z obu faz i usuń duplikaty
        const uniqueWeeks = new Map();

        for (const week of weeksForClanPhase1) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    createdAt: week.createdAt,
                    hasPhase1: true,
                    hasPhase2: false
                });
            } else {
                uniqueWeeks.get(key).hasPhase1 = true;
            }
        }

        for (const week of weeksForClanPhase2) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    createdAt: week.createdAt,
                    hasPhase1: false,
                    hasPhase2: true
                });
            } else {
                uniqueWeeks.get(key).hasPhase2 = true;
            }
        }

        const weeksForClan = Array.from(uniqueWeeks.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        if (weeksForClan.length === 0) {
            await interaction.editReply({
                content: `❌ Brak zapisanych wyników dla klanu ${clanName}.\n\nAby dodać zdjęcie, najpierw zapisz wyniki używając \`/faza1\` lub \`/faza2\` dla wybranego tygodnia.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Twórz select menu z tygodniami (max 25)
        const weekOptions = weeksForClan.slice(0, 25).map(week => {
            const phases = [];
            if (week.hasPhase1) phases.push('F1');
            if (week.hasPhase2) phases.push('F2');
            const phasesLabel = phases.join(', ');

            return new StringSelectMenuOptionBuilder()
                .setLabel(`Tydzień ${week.weekNumber}/${week.year} (${phasesLabel})`)
                .setValue(`${week.weekNumber}-${week.year}`)
                .setDescription(`Klan: ${clanName}`);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`img_select_week|${selectedClan}`)
            .setPlaceholder('Wybierz tydzień')
            .addOptions(weekOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📷 Dodaj zdjęcie')
            .setDescription(`**Krok 2/3:** Wybierz tydzień\n**Klan:** ${clanName}`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

    } catch (error) {
        logger.error('[IMG] ❌ Błąd wyboru klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru klanu.',
            embeds: [],
            components: []
        });
    }
}

async function handleImgWeekSelect(interaction, sharedState) {
    const { config, databaseService } = sharedState;
    const [prefix, clan] = interaction.customId.split('|');
    const selectedWeek = interaction.values[0];
    const [weekNumber, year] = selectedWeek.split('-');

    const clanName = config.roleDisplayNames[clan];

    try {
        const embed = new EmbedBuilder()
            .setTitle('📷 Dodaj zdjęcie')
            .setDescription(`**Krok 3/3:** Wyślij zdjęcie z tabelą wyników\n**Tydzień:** ${selectedWeek}\n**Klan:** ${clanName}\n\n⏳ Czekam na zdjęcie... (15 minut)`)
            .setColor('#00FF00')
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: []
        });

        // Stwórz message collector aby poczekać na zdjęcie (15 minut)
        const filter = m => m.author.id === interaction.user.id && m.attachments.size > 0;
        const collector = interaction.channel.createMessageCollector({ filter, time: 900000, max: 1 });

        collector.on('collect', async (message) => {
            try {
                const attachment = message.attachments.first();

                // Sprawdź czy załącznik to obraz
                if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
                    await interaction.editReply({
                        embeds: [new EmbedBuilder()
                            .setTitle('❌ Błąd')
                            .setDescription('Przesłany plik nie jest obrazem. Spróbuj ponownie używając komendy `/img`.')
                            .setColor('#FF0000')
                        ],
                        components: []
                    });
                    return;
                }

                // Pobierz obraz
                const fs = require('fs').promises;
                const path = require('path');
                const axios = require('axios');

                const response = await axios.get(attachment.url, { responseType: 'arraybuffer' });
                const buffer = Buffer.from(response.data);

                // Określ ścieżkę do katalogu z danymi
                const phaseDir = path.join(
                    __dirname,
                    '../data/phases',
                    `guild_${interaction.guild.id}`,
                    'phase2',
                    year.toString()
                );

                // Upewnij się że katalog istnieje
                await fs.mkdir(phaseDir, { recursive: true });

                // Zapisz zdjęcie jako week-{weekNumber}_{clan}_table.png
                const extension = attachment.name.split('.').pop();
                const imagePath = path.join(phaseDir, `week-${weekNumber}_${clan}_table.${extension}`);
                await fs.writeFile(imagePath, buffer);

                logger.info(`[IMG] ✅ Zapisano zdjęcie: ${imagePath}`);

                // Usuń wiadomość użytkownika ze zdjęciem
                try {
                    await message.delete();
                } catch (error) {
                    logger.warn('[IMG] ⚠️ Nie można usunąć wiadomości użytkownika:', error.message);
                }

                // Zaktualizuj embed
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('✅ Zdjęcie dodane')
                        .setDescription(`Pomyślnie dodano zdjęcie do tygodnia **${selectedWeek}** dla klanu **${clanName}**.\n\nZdjęcie będzie widoczne w komendzie \`/wyniki\`.`)
                        .setColor('#00FF00')
                        .setImage(attachment.url)
                        .setTimestamp()
                    ],
                    components: []
                });

            } catch (error) {
                logger.error('[IMG] ❌ Błąd zapisywania zdjęcia:', error);
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('❌ Błąd')
                        .setDescription('Wystąpił błąd podczas zapisywania zdjęcia.')
                        .setColor('#FF0000')
                    ],
                    components: []
                });
            }
        });

        collector.on('end', async (collected) => {
            if (collected.size === 0) {
                await interaction.editReply({
                    embeds: [new EmbedBuilder()
                        .setTitle('⏱️ Czas minął')
                        .setDescription('Nie otrzymano zdjęcia w ciągu 15 minut. Użyj komendy `/img` lub przycisku "📷 Dodaj zdjęcie" ponownie.')
                        .setColor('#FFA500')
                    ],
                    components: []
                });
            }
        });

    } catch (error) {
        logger.error('[IMG] ❌ Błąd handlera wyboru tygodnia:', error);
        await interaction.update({
            embeds: [new EmbedBuilder()
                .setTitle('❌ Błąd')
                .setDescription('Wystąpił błąd podczas przetwarzania żądania.')
                .setColor('#FF0000')
            ],
            components: []
        });
    }
}

async function handleDodajModalSubmit(interaction, sharedState) {
    const { config, databaseService } = sharedState;
    const customIdParts = interaction.customId.split('|');
    const [prefix, phase, clan, weekNumber, round, userId] = customIdParts;

    const scoreInput = interaction.fields.getTextInputValue('score');
    const scoreNum = parseInt(scoreInput);

    if (isNaN(scoreNum)) {
        await interaction.reply({
            content: '❌ Wynik musi być liczbą.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Pobierz informacje o użytkowniku
        const member = await interaction.guild.members.fetch(userId);
        const displayName = member.displayName;

        const [week, year] = weekNumber.split('-');

        if (phase === 'phase1') {
            // Dodaj gracza do Fazy 1
            const weekData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            if (!weekData) {
                await interaction.editReply({
                    content: '❌ Nie znaleziono danych dla tego tygodnia.'
                });
                return;
            }

            // Zapisz nowego gracza
            await databaseService.savePhase1Result(
                interaction.guild.id,
                userId, // userId
                displayName, // displayName
                scoreNum, // score
                parseInt(week),
                parseInt(year),
                clan,
                null // createdBy - nie nadpisujemy oryginalnego autora
            );

            // Odśwież dane i przelicz TOP30
            const updatedData = await databaseService.getPhase1Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            const sortedPlayers = [...updatedData.players].sort((a, b) => b.score - a.score);
            const top30 = sortedPlayers.slice(0, 30);
            const top30Sum = top30.reduce((sum, p) => sum + p.score, 0);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Gracz dodany - Faza 1')
                    .setDescription(`Dodano gracza **${displayName}** z wynikiem **${scoreNum}**`)
                    .addFields(
                        { name: 'Tydzień', value: `${week}/${year}`, inline: true },
                        { name: 'Klan', value: config.roleDisplayNames[clan], inline: true },
                        { name: 'TOP30 (suma)', value: top30Sum.toString(), inline: true }
                    )
                    .setColor('#00FF00')
                    .setTimestamp()
                ]
            });

        } else if (phase === 'phase2') {
            // Dodaj gracza do Fazy 2
            const weekData = await databaseService.getPhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan
            );

            if (!weekData) {
                await interaction.editReply({
                    content: '❌ Nie znaleziono danych dla tego tygodnia.'
                });
                return;
            }

            if (round === 'summary') {
                // Dodaj do podsumowania
                weekData.summary.players.push({
                    userId: userId,
                    displayName: displayName,
                    score: scoreNum
                });
            } else {
                // Dodaj do konkretnej rundy
                const roundIndex = round === 'round1' ? 0 : round === 'round2' ? 1 : 2;

                weekData.rounds[roundIndex].players.push({
                    userId: userId,
                    displayName: displayName,
                    score: scoreNum
                });

                // Przelicz sumę wyników dla tego gracza we wszystkich rundach
                let totalScore = 0;
                for (const r of weekData.rounds) {
                    const playerInRound = r.players.find(p => p.userId === userId);
                    if (playerInRound) {
                        totalScore += playerInRound.score;
                    }
                }

                // Zaktualizuj podsumowanie
                const playerInSummary = weekData.summary.players.find(p => p.userId === userId);
                if (playerInSummary) {
                    playerInSummary.score = totalScore;
                } else {
                    weekData.summary.players.push({
                        userId: userId,
                        displayName: displayName,
                        score: totalScore
                    });
                }
            }

            // Zapisz dane (zachowaj oryginalnego autora)
            await databaseService.savePhase2Results(
                interaction.guild.id,
                parseInt(week),
                parseInt(year),
                clan,
                weekData.rounds,
                weekData.summary.players,
                weekData.createdBy || interaction.user.id
            );

            const roundName = round === 'summary' ? 'Podsumowanie' :
                              round === 'round1' ? 'Runda 1' :
                              round === 'round2' ? 'Runda 2' : 'Runda 3';

            // Policz sumę dla podsumowania
            const summarySum = weekData.summary.players.reduce((sum, p) => sum + p.score, 0);

            await interaction.editReply({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Gracz dodany - Faza 2')
                    .setDescription(`Dodano gracza **${displayName}** z wynikiem **${scoreNum}**`)
                    .addFields(
                        { name: 'Tydzień', value: `${week}/${year}`, inline: true },
                        { name: 'Klan', value: config.roleDisplayNames[clan], inline: true },
                        { name: 'Runda', value: roundName, inline: true },
                        { name: 'Suma (podsumowanie)', value: summarySum.toString(), inline: false }
                    )
                    .setColor('#00FF00')
                    .setTimestamp()
                ]
            });
        }

    } catch (error) {
        logger.error('[DODAJ] ❌ Błąd dodawania gracza:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas dodawania gracza.'
        });
    }
}

// =============== MODYFIKUJ HANDLERS ===============

async function handleModyfikujCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź uprawnienia (admin lub allowedPunishRoles)
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Nie masz uprawnień do używania tej komendy. Wymagane: **Administrator** lub rola moderatora.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Wykryj klan użytkownika
    const targetRoleIds = Object.entries(config.targetRoles);
    let userClan = null;

    for (const [clanKey, roleId] of targetRoleIds) {
        if (interaction.member.roles.cache.has(roleId)) {
            userClan = clanKey;
            break;
        }
    }

    if (!userClan) {
        await interaction.reply({
            content: '❌ Nie wykryto Twojego klanu. Musisz mieć jedną z ról klanowych aby modyfikować wyniki.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    const selectedPhase = interaction.options.getString('faza');

    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        // Pomiń wybór klanu i przejdź bezpośrednio do wyboru tygodnia
        await showModyfikujWeekSelection(interaction, databaseService, config, userClan, selectedPhase, null, 0);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd komendy /modyfikuj:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas uruchamiania komendy.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function showModyfikujWeekSelection(interaction, databaseService, config, userClan, selectedPhase, selectedRound = null, page = 0) {
    const clanName = config.roleDisplayNames[userClan];

    // Pobierz dostępne tygodnie dla wybranego klanu i fazy
    let allWeeks;
    if (selectedPhase === 'phase2') {
        allWeeks = await databaseService.getAvailableWeeksPhase2(interaction.guild.id);
    } else {
        allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
    }

    const weeksForClan = allWeeks.filter(week => week.clans.includes(userClan));

    if (weeksForClan.length === 0) {
        await interaction.editReply({
            content: `❌ Brak zapisanych wyników dla klanu **${clanName}**.`,
            components: []
        });
        return;
    }

    // Paginacja tygodni
    const weeksPerPage = 20;
    const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIndex = currentPage * weeksPerPage;
    const endIndex = startIndex + weeksPerPage;
    const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

    // Utwórz select menu z tygodniami
    const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(`modyfikuj_select_week_${customIdSuffix}`)
        .setPlaceholder('Wybierz tydzień')
        .addOptions(
            weeksOnPage.map(week => {
                const date = new Date(week.createdAt);
                const dateStr = date.toLocaleDateString('pl-PL', {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric'
                });

                return new StringSelectMenuOptionBuilder()
                    .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                    .setDescription(`Zapisano: ${dateStr}`)
                    .setValue(`${userClan}|${week.weekNumber}-${week.year}`);
            })
        );

    const components = [new ActionRowBuilder().addComponents(selectMenu)];

    // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
    if (totalPages > 1) {
        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_prev|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_info|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel(`Strona ${currentPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_next|${customIdSuffix}|${userClan}|${currentPage}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(currentPage === totalPages - 1)
            );
        components.push(paginationRow);
    }

    const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
    const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';
    const stepNumber = selectedPhase === 'phase2' ? (selectedRound ? '3/3' : '1/3') : '1/2';

    const embed = new EmbedBuilder()
        .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}${roundText}`)
        .setDescription(`**Krok ${stepNumber}:** Wybierz tydzień\n**Klan:** ${clanName}\n\nTygodni: ${weeksForClan.length}${totalPages > 1 ? ` | Strona ${currentPage + 1}/${totalPages}` : ''}`)
        .setColor('#FF9900')
        .setTimestamp();

    await interaction.editReply({
        embeds: [embed],
        components: components
    });
}

async function handleModyfikujClanSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Format: modyfikuj_select_clan|phase1 lub modyfikuj_select_clan|phase2
        const parts = interaction.customId.split('|');
        const selectedPhase = parts[1];
        const selectedClan = interaction.values[0];

        // Krok 2: Pokaż wybór tygodnia
        await showModyfikujWeekSelection(interaction, databaseService, config, selectedClan, selectedPhase, null, 0);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru klanu.',
            components: []
        });
    }
}

async function handleModyfikujRoundSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Format: modyfikuj_select_round|clan|weekNumber-year|phase
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const selectedPhase = parts[3];
        const selectedRound = interaction.values[0];

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const clanName = config.roleDisplayNames[clan];

        // Pobierz wyniki dla wybranego tygodnia
        const weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        // Wybierz graczy z odpowiedniej rundy
        let players;
        if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
            players = weekData.rounds[0].players;
        } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
            players = weekData.rounds[1].players;
        } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
            players = weekData.rounds[2].players;
        } else {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranej rundy.`,
                components: []
            });
            return;
        }

        if (!players || players.length === 0) {
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranej rundy.`,
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const currentPage = 0;
        const startIndex = 0;
        const endIndex = playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami
        const customIdSuffix = `${selectedPhase}|${selectedRound}`;
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${customIdSuffix}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
        if (totalPages > 1) {
            const paginationRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel('◀ Poprzednia')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel(`Strona 1/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${currentPage}|${customIdSuffix}`)
                        .setLabel('Następna ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(totalPages === 1)
                );
            components.push(paginationRow);
        }

        const roundText = selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : 'Runda 3';
        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - Faza 2 - ${roundText}`)
            .setDescription(`**Krok 4/4:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length}${totalPages > 1 ? ` | Strona 1/${totalPages}` : ''}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru rundy:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru rundy.',
            components: []
        });
    }
}

async function handleModyfikujWeekSelect(interaction, sharedState, page = 0) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        // Parsuj customId: modyfikuj_select_week_phase1 lub modyfikuj_select_week_phase2
        const customIdParts = interaction.customId.replace('modyfikuj_select_week_', '').split('|');
        const selectedPhase = customIdParts[0]; // phase1 lub phase2

        const selectedValue = interaction.values[0];
        const [clan, weekKey] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        const clanName = config.roleDisplayNames[clan];

        // Dla Fazy 2 - pokaż wybór rundy
        if (selectedPhase === 'phase2') {
            const roundOptions = [
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 1')
                    .setValue('round1'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 2')
                    .setValue('round2'),
                new StringSelectMenuOptionBuilder()
                    .setLabel('Runda 3')
                    .setValue('round3')
            ];

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId(`modyfikuj_select_round|${clan}|${weekNumber}-${year}|${selectedPhase}`)
                .setPlaceholder('Wybierz rundę')
                .addOptions(roundOptions);

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const embed = new EmbedBuilder()
                .setTitle('🔧 Modyfikacja wyniku - Faza 2')
                .setDescription(`**Krok 3/4:** Wybierz rundę\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}`)
                .setColor('#FF9900')
                .setTimestamp();

            await interaction.editReply({
                embeds: [embed],
                components: [row]
            });
            return;
        }

        // Dla Fazy 1 - pokaż wybór gracza
        const weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData || !weekData.players) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        const players = weekData.players;

        if (!players || players.length === 0) {
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranego tygodnia.`,
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const currentPage = Math.max(0, Math.min(page, totalPages - 1));
        const startIndex = currentPage * playersPerPage;
        const endIndex = startIndex + playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${selectedPhase}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji jeśli jest więcej niż 1 strona
        if (totalPages > 1) {
            const paginationRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel('◀ Poprzednia')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === 0),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel(`Strona ${currentPage + 1}/${totalPages}`)
                        .setStyle(ButtonStyle.Secondary)
                        .setDisabled(true),
                    new ButtonBuilder()
                        .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${currentPage}|${selectedPhase}`)
                        .setLabel('Następna ▶')
                        .setStyle(ButtonStyle.Primary)
                        .setDisabled(currentPage === totalPages - 1)
                );
            components.push(paginationRow);
        }

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const stepNumber = '3/3';

        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}`)
            .setDescription(`**Krok ${stepNumber}:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length}${totalPages > 1 ? ` | Strona ${currentPage + 1}/${totalPages}` : ''}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru tygodnia:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru tygodnia.',
            components: []
        });
    }
}

async function handleModyfikujPlayerSelect(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Parsuj customId: modyfikuj_select_player_phase1 lub modyfikuj_select_player_phase2|round1
        const customIdParts = interaction.customId.replace('modyfikuj_select_player_', '').split('|');
        const selectedPhase = customIdParts[0];
        const selectedRound = customIdParts[1] || null;

        const selectedValue = interaction.values[0];
        const [clan, weekKey, userId] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        logger.info(`[MODYFIKUJ] Wybrano gracza: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekNumber}/${year}, userId=${userId}`);

        // Pobierz dane gracza
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase2: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.reply({
                    content: '❌ Nie znaleziono danych dla wybranego tygodnia.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            logger.info(`[MODYFIKUJ] weekData structure: rounds=${weekData.rounds ? 'exists' : 'null'}, roundsLength=${weekData.rounds?.length}`);

            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                logger.info(`[MODYFIKUJ] Szukam w round1, players count: ${weekData.rounds[0].players?.length}`);
                player = weekData.rounds[0].players.find(p => p.userId === userId);
                logger.info(`[MODYFIKUJ] Znaleziono gracza w round1: ${player ? 'TAK' : 'NIE'}`);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                logger.info(`[MODYFIKUJ] Szukam w round2, players count: ${weekData.rounds[1].players?.length}`);
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                logger.info(`[MODYFIKUJ] Szukam w round3, players count: ${weekData.rounds[2].players?.length}`);
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            } else {
                logger.error(`[MODYFIKUJ] Nie można znaleźć rundy: selectedRound=${selectedRound}, weekData.rounds[0]=${weekData.rounds?.[0] ? 'exists' : 'null'}`);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData || !weekData.players) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase1: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}, weekData=${weekData}`);
                await interaction.reply({
                    content: '❌ Nie znaleziono danych dla wybranego tygodnia.',
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            logger.error(`[MODYFIKUJ] Nie znaleziono gracza: userId=${userId}, phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekNumber}/${year}`);
            await interaction.reply({
                content: '❌ Nie znaleziono gracza.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Pokaż modal do wprowadzenia nowego wyniku
        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const modal = new ModalBuilder()
            .setCustomId(`modyfikuj_modal_${customIdSuffix}|${clan}|${weekNumber}-${year}|${userId}`)
            .setTitle('Modyfikuj wynik gracza');

        const scoreInput = new TextInputBuilder()
            .setCustomId('new_score')
            .setLabel(`Nowy wynik dla ${player.displayName}`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`Aktualny wynik: ${player.score}`)
            .setRequired(true)
            .setMinLength(1)
            .setMaxLength(6);

        const row = new ActionRowBuilder().addComponents(scoreInput);
        modal.addComponents(row);

        await interaction.showModal(modal);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd wyboru gracza:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas wyboru gracza.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModyfikujPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const parts = interaction.customId.split('|');
        const action = parts[0]; // modyfikuj_page_prev lub modyfikuj_page_next
        const clan = parts[1];
        const weekKey = parts[2];
        const currentPage = parseInt(parts[3]);
        const selectedPhase = parts[4] || 'phase1'; // phase1 lub phase2
        const selectedRound = parts[5] || null; // round1, round2, round3 lub null

        const [weekNumber, year] = weekKey.split('-').map(Number);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'modyfikuj_page_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'modyfikuj_page_next') {
            newPage = currentPage + 1;
        }

        const clanName = config.roleDisplayNames[clan];

        // Pobierz wyniki dla wybranego tygodnia i klanu
        let weekData;
        let players;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase2: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.editReply({
                    content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            // Wybierz graczy z odpowiedniej rundy (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                players = weekData.rounds[0].players;
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                players = weekData.rounds[1].players;
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                players = weekData.rounds[2].players;
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);

            if (!weekData) {
                logger.error(`[MODYFIKUJ] Brak weekData dla Phase1: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}`);
                await interaction.editReply({
                    content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                    embeds: [],
                    components: []
                });
                return;
            }

            players = weekData.players;
        }

        if (!players || players.length === 0) {
            logger.error(`[MODYFIKUJ] Brak players dla: guild=${interaction.guild.id}, week=${weekNumber}, year=${year}, clan=${clan}, phase=${selectedPhase}, round=${selectedRound}`);
            await interaction.editReply({
                content: `❌ Brak graczy dla wybranego tygodnia i klanu **${clanName}**.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Sortuj graczy alfabetycznie
        const sortedPlayers = [...players].sort((a, b) => a.displayName.localeCompare(b.displayName));

        // Paginacja
        const playersPerPage = 20;
        const totalPages = Math.ceil(sortedPlayers.length / playersPerPage);
        const validPage = Math.max(0, Math.min(newPage, totalPages - 1));
        const startIndex = validPage * playersPerPage;
        const endIndex = startIndex + playersPerPage;
        const playersOnPage = sortedPlayers.slice(startIndex, endIndex);

        // Utwórz select menu z graczami na aktualnej stronie
        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`modyfikuj_select_player_${customIdSuffix}`)
            .setPlaceholder('Wybierz gracza')
            .addOptions(
                playersOnPage.map(player => {
                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`${player.displayName} - ${player.score} pkt`)
                        .setValue(`${clan}|${weekNumber}-${year}|${player.userId}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji
        const paginationCustomId = selectedRound
            ? `|${selectedPhase}|${selectedRound}`
            : `|${selectedPhase}`;

        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_prev|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_info|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel(`Strona ${validPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_page_next|${clan}|${weekNumber}-${year}|${validPage}${paginationCustomId}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === totalPages - 1)
            );
        components.push(paginationRow);

        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';
        const stepNumber = selectedPhase === 'phase2' ? (selectedRound ? '4/4' : '?/4') : '3/3';

        const embed = new EmbedBuilder()
            .setTitle(`🔧 Modyfikacja wyniku - ${phaseTitle}${roundText}`)
            .setDescription(`**Krok ${stepNumber}:** Wybierz gracza do modyfikacji\n**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n\nGraczy: ${sortedPlayers.length} | Strona ${validPage + 1}/${totalPages}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd paginacji:', error);
        logger.error('[MODYFIKUJ] ❌ Error stack:', error.stack);
        logger.error('[MODYFIKUJ] ❌ customId:', interaction.customId);

        try {
            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({
                    content: '❌ Wystąpił błąd podczas zmiany strony.',
                    embeds: [],
                    components: []
                });
            } else {
                await interaction.update({
                    content: '❌ Wystąpił błąd podczas zmiany strony.',
                    embeds: [],
                    components: []
                });
            }
        } catch (replyError) {
            logger.error('[MODYFIKUJ] ❌ Błąd podczas odpowiedzi na błąd:', replyError);
        }
    }
}

async function handleModyfikujWeekPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        const parts = interaction.customId.split('|');
        const action = parts[0]; // modyfikuj_week_prev lub modyfikuj_week_next
        const clan = parts[1];
        const currentPage = parseInt(parts[2]);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'modyfikuj_week_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'modyfikuj_week_next') {
            newPage = currentPage + 1;
        }

        const clanName = config.roleDisplayNames[clan];

        // Pobierz dostępne tygodnie dla wybranego klanu
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
        const weeksForClan = allWeeks.filter(week => week.clans.includes(clan));

        if (weeksForClan.length === 0) {
            await interaction.update({
                content: `❌ Brak zapisanych wyników dla klanu **${clanName}**.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Paginacja tygodni
        const weeksPerPage = 20;
        const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
        const validPage = Math.max(0, Math.min(newPage, totalPages - 1));
        const startIndex = validPage * weeksPerPage;
        const endIndex = startIndex + weeksPerPage;
        const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

        // Utwórz select menu z tygodniami na aktualnej stronie
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('modyfikuj_select_week')
            .setPlaceholder('Wybierz tydzień')
            .addOptions(
                weeksOnPage.map(week => {
                    const date = new Date(week.createdAt);
                    const dateStr = date.toLocaleDateString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });

                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`Tydzień ${week.weekNumber}/${week.year}`)
                        .setDescription(`Zapisano: ${dateStr}`)
                        .setValue(`${clan}|${week.weekNumber}-${week.year}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski paginacji
        const paginationRow = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_prev|${clan}|${validPage}`)
                    .setLabel('◀ Poprzednia')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === 0),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_info|${clan}|${validPage}`)
                    .setLabel(`Strona ${validPage + 1}/${totalPages}`)
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(true),
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_week_next|${clan}|${validPage}`)
                    .setLabel('Następna ▶')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(validPage === totalPages - 1)
            );
        components.push(paginationRow);

        const embed = new EmbedBuilder()
            .setTitle('🔧 Modyfikacja wyniku - Faza 1')
            .setDescription(`**Krok 2/4:** Wybierz tydzień dla klanu **${clanName}**\n\nTygodni: ${weeksForClan.length} | Strona ${validPage + 1}/${totalPages}`)
            .setColor('#FF9900')
            .setTimestamp();

        await interaction.update({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd paginacji tygodni:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zmiany strony.',
            embeds: [],
            components: []
        });
    }
}

async function handleModyfikujModalSubmit(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Parsuj customId: modyfikuj_modal_phase1|clan|week|userId lub modyfikuj_modal_phase2|round1|clan|week|userId
        const customIdParts = interaction.customId.replace('modyfikuj_modal_', '').split('|');

        let selectedPhase, selectedRound, clan, weekKey, userId;

        logger.info(`[MODYFIKUJ] Modal customId parts: ${JSON.stringify(customIdParts)}`);

        if (customIdParts[0] === 'phase2') {
            selectedPhase = customIdParts[0];
            selectedRound = customIdParts[1];
            clan = customIdParts[2];
            weekKey = customIdParts[3];
            userId = customIdParts[4];
        } else {
            selectedPhase = customIdParts[0];
            selectedRound = null;
            clan = customIdParts[1];
            weekKey = customIdParts[2];
            userId = customIdParts[3];
        }

        logger.info(`[MODYFIKUJ] Modal parsed: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekKey}, userId=${userId}`);

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const newScore = interaction.fields.getTextInputValue('new_score');

        // Walidacja nowego wyniku
        if (!/^\d+$/.test(newScore)) {
            await interaction.reply({
                content: '❌ Wynik musi być liczbą całkowitą.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const newScoreNum = parseInt(newScore);

        // Pobierz dane gracza
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                player = weekData.rounds[0].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            await interaction.reply({
                content: '❌ Nie znaleziono gracza.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const clanName = config.roleDisplayNames[clan];
        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';

        // Pokaż potwierdzenie
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Potwierdzenie zmiany wyniku - ${phaseTitle}${roundText}`)
            .setDescription(`Czy na pewno chcesz zmienić wynik dla **${player.displayName}**?`)
            .setColor('#FF9900')
            .addFields(
                { name: '🎯 Klan', value: clanName, inline: true },
                { name: '📅 Tydzień', value: `${weekNumber}/${year}`, inline: true },
                { name: '📊 Stary wynik', value: player.score.toString(), inline: true },
                { name: '📈 Nowy wynik', value: newScoreNum.toString(), inline: true }
            )
            .setTimestamp();

        const customIdSuffix = selectedRound ? `${selectedPhase}|${selectedRound}` : selectedPhase;
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`modyfikuj_confirm_${customIdSuffix}|${clan}|${weekNumber}-${year}|${userId}|${newScoreNum}`)
                    .setLabel('🟢 Zamień')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('modyfikuj_cancel')
                    .setLabel('🔴 Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        await interaction.reply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd modala:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas przetwarzania formularza.',
            flags: MessageFlags.Ephemeral
        });
    }
}

async function handleModyfikujConfirmButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    if (interaction.customId === 'modyfikuj_cancel') {
        await interaction.update({
            content: '❌ Operacja anulowana.',
            embeds: [],
            components: []
        });
        return;
    }

    try {
        // Parsuj customId: modyfikuj_confirm_phase1|clan|week|userId|score lub modyfikuj_confirm_phase2|round1|clan|week|userId|score
        const customIdParts = interaction.customId.replace('modyfikuj_confirm_', '').split('|');

        let selectedPhase, selectedRound, clan, weekKey, userId, newScore;

        logger.info(`[MODYFIKUJ] Confirm customId parts: ${JSON.stringify(customIdParts)}`);

        if (customIdParts[0] === 'phase2') {
            selectedPhase = customIdParts[0];
            selectedRound = customIdParts[1];
            clan = customIdParts[2];
            weekKey = customIdParts[3];
            userId = customIdParts[4];
            newScore = customIdParts[5];
        } else {
            selectedPhase = customIdParts[0];
            selectedRound = null;
            clan = customIdParts[1];
            weekKey = customIdParts[2];
            userId = customIdParts[3];
            newScore = customIdParts[4];
        }

        logger.info(`[MODYFIKUJ] Confirm parsed: phase=${selectedPhase}, round=${selectedRound}, clan=${clan}, week=${weekKey}, userId=${userId}, newScore=${newScore}`);

        const [weekNumber, year] = weekKey.split('-').map(Number);
        const newScoreNum = parseInt(newScore);

        // Pobierz dane gracza przed zmianą
        let weekData;
        let player;

        if (selectedPhase === 'phase2') {
            weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

            // Znajdź gracza w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1' && weekData.rounds && weekData.rounds[0]) {
                player = weekData.rounds[0].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round2' && weekData.rounds && weekData.rounds[1]) {
                player = weekData.rounds[1].players.find(p => p.userId === userId);
            } else if (selectedRound === 'round3' && weekData.rounds && weekData.rounds[2]) {
                player = weekData.rounds[2].players.find(p => p.userId === userId);
            }
        } else {
            weekData = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
            player = weekData.players.find(p => p.userId === userId);
        }

        if (!player) {
            await interaction.update({
                content: '❌ Nie znaleziono gracza.',
                embeds: [],
                components: []
            });
            return;
        }

        const oldScore = player.score;

        // Zaktualizuj wynik
        if (selectedPhase === 'phase2') {
            // Aktualizuj wynik w odpowiedniej rundzie (tylko round1, round2, round3)
            if (selectedRound === 'round1') {
                weekData.rounds[0].players = weekData.rounds[0].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            } else if (selectedRound === 'round2') {
                weekData.rounds[1].players = weekData.rounds[1].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            } else if (selectedRound === 'round3') {
                weekData.rounds[2].players = weekData.rounds[2].players.map(p =>
                    p.userId === userId ? { ...p, score: newScoreNum } : p
                );
            }

            // Przelicz sumę wyników dla wszystkich graczy
            const summedScores = new Map(); // userId -> total score
            for (const round of weekData.rounds) {
                for (const p of round.players) {
                    const current = summedScores.get(p.userId) || 0;
                    summedScores.set(p.userId, current + p.score);
                }
            }

            // Zaktualizuj summary.players z nowymi sumami
            weekData.summary.players = weekData.summary.players.map(p => ({
                ...p,
                score: summedScores.get(p.userId) || 0
            }));

            logger.info(`[MODYFIKUJ] Zaktualizowano sumę dla gracza ${userId}: ${summedScores.get(userId)}`);

            // Zapisz zaktualizowane dane (zachowaj oryginalnego creatora)
            await databaseService.savePhase2Results(
                interaction.guild.id,
                weekNumber,
                year,
                clan,
                weekData.rounds,
                weekData.summary.players,
                weekData.createdBy || interaction.user.id
            );
        } else {
            await databaseService.savePhase1Result(
                interaction.guild.id,
                userId,
                player.displayName,
                newScoreNum,
                weekNumber,
                year,
                clan
            );
        }

        const clanName = config.roleDisplayNames[clan];
        const phaseTitle = selectedPhase === 'phase2' ? 'Faza 2' : 'Faza 1';
        const roundText = selectedRound ? ` - ${selectedRound === 'round1' ? 'Runda 1' : selectedRound === 'round2' ? 'Runda 2' : selectedRound === 'round3' ? 'Runda 3' : 'Suma'}` : '';

        // Potwierdzenie
        const embed = new EmbedBuilder()
            .setTitle(`✅ Wynik został zmieniony - ${phaseTitle}${roundText}`)
            .setDescription(`Pomyślnie zmieniono wynik dla **${player.displayName}**`)
            .setColor('#00FF00')
            .addFields(
                { name: '🎯 Klan', value: clanName, inline: true },
                { name: '📅 Tydzień', value: `${weekNumber}/${year}`, inline: true },
                { name: '📊 Stary wynik', value: oldScore.toString(), inline: true },
                { name: '📈 Nowy wynik', value: newScoreNum.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: `Zmodyfikowane przez ${interaction.user.tag}` });

        await interaction.update({
            embeds: [embed],
            components: []
        });

        logger.info(`[MODYFIKUJ] ✅ Zmieniono wynik ${player.displayName}: ${oldScore} → ${newScoreNum} (Klan: ${clan}, Tydzień: ${weekNumber}/${year})`);

    } catch (error) {
        logger.error('[MODYFIKUJ] ❌ Błąd potwierdzenia:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zapisywania zmiany.',
            embeds: [],
            components: []
        });
    }
}

// =============== WYNIKI HANDLERS ===============

async function handleWynikiClanSelect(interaction, sharedState, page = 0) {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const selectedClan = interaction.values[0];
        const clanName = config.roleDisplayNames[selectedClan];

        // Pobierz dostępne tygodnie dla wybranego klanu z obu faz
        const allWeeksPhase1 = await databaseService.getAvailableWeeks(interaction.guild.id);
        const allWeeksPhase2 = await databaseService.getAvailableWeeksPhase2(interaction.guild.id);

        const weeksForClanPhase1 = allWeeksPhase1.filter(week => week.clans.includes(selectedClan));
        const weeksForClanPhase2 = allWeeksPhase2.filter(week => week.clans.includes(selectedClan));

        // Połącz tygodnie z obu faz i posortuj po numerze tygodnia (malejąco)
        const combinedWeeks = [];

        // Znajdź wszystkie unikalne tygodnie
        const uniqueWeeks = new Map();

        for (const week of weeksForClanPhase1) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    hasPhase1: true,
                    hasPhase2: false,
                    createdAt: week.createdAt
                });
            } else {
                uniqueWeeks.get(key).hasPhase1 = true;
            }
        }

        for (const week of weeksForClanPhase2) {
            const key = `${week.weekNumber}-${week.year}`;
            if (!uniqueWeeks.has(key)) {
                uniqueWeeks.set(key, {
                    weekNumber: week.weekNumber,
                    year: week.year,
                    hasPhase1: false,
                    hasPhase2: true,
                    createdAt: week.createdAt
                });
            } else {
                uniqueWeeks.get(key).hasPhase2 = true;
            }
        }

        const weeksForClan = Array.from(uniqueWeeks.values()).sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        if (weeksForClan.length === 0) {
            await interaction.editReply({
                content: `📊 Brak zapisanych wyników dla klanu **${clanName}**.\n\nUżyj \`/faza1\` lub \`/faza2\` aby rozpocząć zbieranie danych.`,
                components: []
            });
            return;
        }

        // Paginacja: 20 tygodni na stronę
        const weeksPerPage = 20;
        const totalPages = Math.ceil(weeksForClan.length / weeksPerPage);
        const startIndex = page * weeksPerPage;
        const endIndex = Math.min(startIndex + weeksPerPage, weeksForClan.length);
        const weeksOnPage = weeksForClan.slice(startIndex, endIndex);

        // Utwórz select menu z tygodniami
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('wyniki_select_week')
            .setPlaceholder('Wybierz tydzień')
            .addOptions(
                weeksOnPage.map(week => {
                    const date = new Date(week.createdAt);
                    const dateStr = date.toLocaleDateString('pl-PL', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric'
                    });

                    const phases = [];
                    if (week.hasPhase1) phases.push('F1');
                    if (week.hasPhase2) phases.push('F2');
                    const phasesLabel = phases.join(', ');

                    return new StringSelectMenuOptionBuilder()
                        .setLabel(`Tydzień ${week.weekNumber}/${week.year} (${phasesLabel})`)
                        .setDescription(`Zapisano: ${dateStr}`)
                        .setValue(`${selectedClan}|${week.weekNumber}-${week.year}`);
                })
            );

        const components = [new ActionRowBuilder().addComponents(selectMenu)];

        // Dodaj przyciski nawigacji jeśli jest więcej niż jedna strona
        if (totalPages > 1) {
            const navRow = new ActionRowBuilder();

            const prevButton = new ButtonBuilder()
                .setCustomId(`wyniki_weeks_prev|${selectedClan}|${page}`)
                .setLabel('◀ Poprzednia')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0);

            const nextButton = new ButtonBuilder()
                .setCustomId(`wyniki_weeks_next|${selectedClan}|${page}`)
                .setLabel('Następna ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1);

            navRow.addComponents(prevButton, nextButton);
            components.push(navRow);
        }

        const embed = new EmbedBuilder()
            .setTitle('📊 Wyniki - Wszystkie Fazy')
            .setDescription(`**Krok 2/2:** Wybierz tydzień dla klanu **${clanName}**:`)
            .setColor('#0099FF')
            .setFooter({ text: `Strona ${page + 1}/${totalPages} | Łącznie tygodni: ${weeksForClan.length}` })
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: components
        });

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd wyboru klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyboru klanu.',
            components: []
        });
    }
}

async function handleWynikiWeekPaginationButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format customId: wyniki_weeks_prev|clanKey|page lub wyniki_weeks_next|clanKey|page
        const customIdParts = interaction.customId.split('|');
        const action = customIdParts[0]; // np. "wyniki_weeks_prev"
        const clan = customIdParts[1];
        const currentPage = parseInt(customIdParts[2]);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'wyniki_weeks_prev') {
            newPage = Math.max(0, currentPage - 1);
        } else if (action === 'wyniki_weeks_next') {
            newPage = currentPage + 1;
        }

        // Wywołaj ponownie handleWynikiClanSelect z nową stroną
        // Musimy przygotować mock interaction z values
        const mockInteraction = {
            ...interaction,
            values: [clan],
            deferUpdate: async () => {} // Mock - już jest deferred
        };

        await handleWynikiClanSelect(mockInteraction, sharedState, newPage);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd paginacji tygodni:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas zmiany strony.',
            embeds: [],
            components: []
        });
    }
}

async function handleWynikiWeekSelect(interaction, sharedState, view = 'phase1') {
    const { databaseService, config } = sharedState;

    await interaction.deferUpdate();

    try {
        const selectedValue = interaction.values[0]; // Format: "clanKey|weekNumber-year"
        const [clan, weekKey] = selectedValue.split('|');
        const [weekNumber, year] = weekKey.split('-').map(Number);

        const clanName = config.roleDisplayNames[clan];

        // Pobierz dane z obu faz
        const weekDataPhase1 = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
        const weekDataPhase2 = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekDataPhase1 && !weekDataPhase2) {
            await interaction.editReply({
                content: `❌ Brak danych dla wybranego tygodnia i klanu **${clanName}**.`,
                components: []
            });
            return;
        }

        // Wyświetl wyniki w zależności od wybranego widoku (domyślnie Faza 1)
        // useFollowUp = true dla publicznej wiadomości
        await showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config, false, true);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd wyświetlania wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyświetlania wyników.',
            components: []
        });
    }
}

async function handleWynikiViewButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format: wyniki_view|clanKey|weekNumber-year|view
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const view = parts[3];

        const [weekNumber, year] = weekKey.split('-').map(Number);

        // Pobierz dane z obu faz
        const weekDataPhase1 = await databaseService.getPhase1Results(interaction.guild.id, weekNumber, year, clan);
        const weekDataPhase2 = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekDataPhase1 && !weekDataPhase2) {
            await interaction.update({
                content: '❌ Brak danych.',
                embeds: [],
                components: []
            });
            return;
        }

        await showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config, true);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd przełączania widoku:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas przełączania widoku.',
            embeds: [],
            components: []
        });
    }
}

async function handleWynikiPhase2ViewButton(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        // Format: wyniki_phase2_view|clanKey|weekNumber-year|view
        const parts = interaction.customId.split('|');
        const clan = parts[1];
        const weekKey = parts[2];
        const view = parts[3];

        const [weekNumber, year] = weekKey.split('-').map(Number);

        const weekData = await databaseService.getPhase2Results(interaction.guild.id, weekNumber, year, clan);

        if (!weekData) {
            await interaction.update({
                content: '❌ Brak danych.',
                embeds: [],
                components: []
            });
            return;
        }

        await showPhase2Results(interaction, weekData, clan, weekNumber, year, view, config, true);

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd przełączania widoku Phase 2:', error);
        await interaction.update({
            content: '❌ Wystąpił błąd podczas przełączania widoku.',
            embeds: [],
            components: []
        });
    }
}

async function showPhase2Results(interaction, weekData, clan, weekNumber, year, view, config, isUpdate = false) {
    const clanName = config.roleDisplayNames[clan];

    // Wybierz dane do wyświetlenia w zależności od widoku
    let players;
    let viewTitle;

    if (view === 'round1' && weekData.rounds && weekData.rounds[0]) {
        players = weekData.rounds[0].players;
        viewTitle = 'Runda 1';
    } else if (view === 'round2' && weekData.rounds && weekData.rounds[1]) {
        players = weekData.rounds[1].players;
        viewTitle = 'Runda 2';
    } else if (view === 'round3' && weekData.rounds && weekData.rounds[2]) {
        players = weekData.rounds[2].players;
        viewTitle = 'Runda 3';
    } else {
        // Domyślnie pokaż sumę
        players = weekData.summary ? weekData.summary.players : weekData.players;
        viewTitle = 'Suma';
    }

    if (!players || players.length === 0) {
        const replyMethod = isUpdate ? 'update' : 'editReply';
        await interaction[replyMethod]({
            content: `❌ Brak danych dla wybranego widoku.`,
            embeds: [],
            components: []
        });
        return;
    }

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    // Oblicz TOP30 dla rund 1, 2, 3 oraz sumy
    let top30Text = '';
    if (view === 'round1' || view === 'round2' || view === 'round3') {
        const top30Players = sortedPlayers.slice(0, 30);
        const top30Sum = top30Players.reduce((sum, player) => sum + player.score, 0);
        top30Text = `**TOP30:** ${top30Sum.toLocaleString('pl-PL')} pkt\n`;
    } else if (view === 'summary') {
        // Dla sumy: oblicz TOP30 z każdej rundy osobno i zsumuj
        let totalTop30Sum = 0;

        if (weekData.rounds && weekData.rounds.length === 3) {
            for (let i = 0; i < 3; i++) {
                if (weekData.rounds[i] && weekData.rounds[i].players) {
                    const roundPlayers = [...weekData.rounds[i].players].sort((a, b) => b.score - a.score);
                    const roundTop30 = roundPlayers.slice(0, 30);
                    const roundTop30Sum = roundTop30.reduce((sum, player) => sum + player.score, 0);
                    totalTop30Sum += roundTop30Sum;
                }
            }
            top30Text = `**TOP30:** ${totalTop30Sum.toLocaleString('pl-PL')} pkt (suma TOP30 z 3 rund)\n`;
        }
    }

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 10;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        const isCaller = player.userId === interaction.user.id;
        const displayName = isCaller ? `**${player.displayName}**` : player.displayName;

        return `${progressBar} ${position}. ${displayName} - ${player.score}`;
    }).join('\n');

    // Pobierz displayName osoby oglądającej
    const viewerDisplayName = interaction.member?.displayName || interaction.user.username;

    const embed = new EmbedBuilder()
        .setTitle(`📊 Wyniki - Faza 2 - ${viewTitle}`)
        .setDescription(`**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n${top30Text}\n${resultsText}`)
        .setColor('#0099FF')
        .setFooter({ text: `Łącznie graczy: ${sortedPlayers.length} | Zapisano: ${new Date(weekData.createdAt).toLocaleDateString('pl-PL')} | Ogląda: ${viewerDisplayName}` })
        .setTimestamp();

    // Przyciski nawigacji między rundami
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round1`)
                .setLabel('Runda 1')
                .setStyle(view === 'round1' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round2`)
                .setLabel('Runda 2')
                .setStyle(view === 'round2' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|round3`)
                .setLabel('Runda 3')
                .setStyle(view === 'round3' ? ButtonStyle.Primary : ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`wyniki_phase2_view|${clan}|${weekNumber}-${year}|summary`)
                .setLabel('Suma')
                .setStyle(view === 'summary' ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );

    // Sprawdź czy istnieje zdjęcie z tabelą wyników
    const fs = require('fs').promises;
    const path = require('path');
    const { AttachmentBuilder } = require('discord.js');

    const phaseDir = path.join(
        __dirname,
        '../data/phases',
        `guild_${interaction.guild.id}`,
        'phase2',
        year.toString()
    );

    // Szukaj pliku ze zdjęciem (różne rozszerzenia)
    const possibleExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    let imageAttachment = null;

    for (const ext of possibleExtensions) {
        const imagePath = path.join(phaseDir, `week-${weekNumber}_${clan}_table.${ext}`);
        try {
            await fs.access(imagePath);
            // Plik istnieje - stwórz attachment
            imageAttachment = new AttachmentBuilder(imagePath, { name: `table.${ext}` });
            embed.setImage(`attachment://table.${ext}`);
            break;
        } catch (error) {
            // Plik nie istnieje - spróbuj następne rozszerzenie
            continue;
        }
    }

    const replyMethod = isUpdate ? 'update' : 'editReply';
    const replyOptions = {
        embeds: [embed],
        components: [navRow]
    };

    if (imageAttachment) {
        replyOptions.files = [imageAttachment];
    }

    await interaction[replyMethod](replyOptions);
}

async function showCombinedResults(interaction, weekDataPhase1, weekDataPhase2, clan, weekNumber, year, view, config, isUpdate = false, useFollowUp = false) {
    const clanName = config.roleDisplayNames[clan];

    // Wybierz dane do wyświetlenia w zależności od widoku
    let players;
    let viewTitle;
    let weekData;

    if (view === 'phase1' && weekDataPhase1) {
        players = weekDataPhase1.players;
        viewTitle = 'Faza 1';
        weekData = weekDataPhase1;
    } else if (view === 'round1' && weekDataPhase2?.rounds?.[0]) {
        players = weekDataPhase2.rounds[0].players;
        viewTitle = 'Runda 1';
        weekData = weekDataPhase2;
    } else if (view === 'round2' && weekDataPhase2?.rounds?.[1]) {
        players = weekDataPhase2.rounds[1].players;
        viewTitle = 'Runda 2';
        weekData = weekDataPhase2;
    } else if (view === 'round3' && weekDataPhase2?.rounds?.[2]) {
        players = weekDataPhase2.rounds[2].players;
        viewTitle = 'Runda 3';
        weekData = weekDataPhase2;
    } else if (view === 'summary' && weekDataPhase2) {
        players = weekDataPhase2.summary ? weekDataPhase2.summary.players : weekDataPhase2.players;
        viewTitle = 'Suma';
        weekData = weekDataPhase2;
    } else {
        // Fallback - pokaż pierwszą dostępną fazę
        if (weekDataPhase1) {
            players = weekDataPhase1.players;
            viewTitle = 'Faza 1';
            weekData = weekDataPhase1;
            view = 'phase1';
        } else if (weekDataPhase2) {
            players = weekDataPhase2.summary ? weekDataPhase2.summary.players : weekDataPhase2.players;
            viewTitle = 'Suma';
            weekData = weekDataPhase2;
            view = 'summary';
        }
    }

    if (!players || players.length === 0) {
        const replyMethod = isUpdate ? 'update' : 'editReply';
        await interaction[replyMethod]({
            content: `❌ Brak danych dla wybranego widoku.`,
            embeds: [],
            components: []
        });
        return;
    }

    const sortedPlayers = [...players].sort((a, b) => b.score - a.score);
    const maxScore = sortedPlayers[0]?.score || 1;

    // Oblicz TOP30 dla Fazy 1 oraz rund 1, 2, 3 i sumy Fazy 2 - pobierz historyczne rekordy
    let descriptionExtra = '';
    let playerHistoricalRecords = new Map(); // userId -> bestScore

    if (view === 'phase1' || view === 'round1' || view === 'round2' || view === 'round3' || view === 'summary') {
        let top30Sum = 0;

        // Dla "Suma Faza 2" - oblicz sumę TOP30 z każdej rundy osobno
        if (view === 'summary' && weekDataPhase2?.rounds) {
            for (let i = 0; i < 3; i++) {
                if (weekDataPhase2.rounds[i] && weekDataPhase2.rounds[i].players) {
                    const roundPlayers = [...weekDataPhase2.rounds[i].players].sort((a, b) => b.score - a.score);
                    const roundTop30 = roundPlayers.slice(0, 30);
                    const roundTop30Sum = roundTop30.reduce((sum, player) => sum + player.score, 0);
                    top30Sum += roundTop30Sum;
                }
            }
        } else {
            // Dla pozostałych widoków - standardowe TOP30
            const top30Players = sortedPlayers.slice(0, 30);
            top30Sum = top30Players.reduce((sum, player) => sum + player.score, 0);
        }

        // Pobierz TOP30 z poprzedniego tygodnia (tylko dla Fazy 1)
        const { databaseService } = interaction.client;
        let top30ProgressText = '';

        if (view === 'phase1' && databaseService) {
            try {
                // Znajdź poprzedni tydzień
                const availableWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
                const weeksForClan = availableWeeks
                    .filter(w => w.clans.includes(clan))
                    .sort((a, b) => {
                        if (a.year !== b.year) return b.year - a.year;
                        return b.weekNumber - a.weekNumber;
                    });

                // Znajdź poprzedni tydzień przed aktualnym
                const currentWeekIndex = weeksForClan.findIndex(w =>
                    w.weekNumber === weekNumber && w.year === year
                );

                if (currentWeekIndex !== -1 && currentWeekIndex < weeksForClan.length - 1) {
                    const previousWeek = weeksForClan[currentWeekIndex + 1];
                    const previousWeekData = await databaseService.getPhase1Results(
                        interaction.guild.id,
                        previousWeek.weekNumber,
                        previousWeek.year,
                        clan
                    );

                    if (previousWeekData && previousWeekData.players) {
                        const previousTop30 = [...previousWeekData.players]
                            .sort((a, b) => b.score - a.score)
                            .slice(0, 30);
                        const previousTop30Sum = previousTop30.reduce((sum, p) => sum + p.score, 0);
                        const top30Difference = top30Sum - previousTop30Sum;

                        if (top30Difference > 0) {
                            top30ProgressText = `\n**Progres:** +${top30Difference.toLocaleString('pl-PL')} pkt`;
                        } else if (top30Difference < 0) {
                            top30ProgressText = `\n**Regres:** ${top30Difference.toLocaleString('pl-PL')} pkt`;
                        }
                    }
                }
            } catch (error) {
                logger.error('[WYNIKI] Błąd pobierania TOP30 z poprzedniego tygodnia:', error);
            }
        }

        // Dodaj informację o sposobie liczenia dla widoku "Suma"
        const summaryNote = view === 'summary' ? ' (suma TOP30 z 3 rund)' : '';
        descriptionExtra = `**TOP30:** ${top30Sum.toLocaleString('pl-PL')} pkt${summaryNote}${top30ProgressText}\n`;

        // Pobierz historyczne rekordy dla wszystkich graczy (tylko dla Fazy 1)
        if (view === 'phase1' && databaseService) {
            for (const player of sortedPlayers) {
                if (player.userId) {
                    const historicalBest = await databaseService.getPlayerHistoricalBestScore(
                        interaction.guild.id,
                        player.userId,
                        weekNumber,
                        year,
                        clan
                    );
                    if (historicalBest !== null) {
                        playerHistoricalRecords.set(player.userId, historicalBest);
                    }
                }
            }
        }
    }

    // Przechowuj informacje o progresie dla każdego gracza (do TOP3)
    const playerProgressData = [];

    const resultsText = sortedPlayers.map((player, index) => {
        const position = index + 1;
        const barLength = 10;
        const filledLength = player.score > 0 ? Math.max(1, Math.round((player.score / maxScore) * barLength)) : 0;
        const progressBar = player.score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        const isCaller = player.userId === interaction.user.id;
        const displayName = isCaller ? `**${player.displayName}**` : player.displayName;

        // Dla Fazy 1 dodaj progres względem historycznego rekordu
        let progressText = '';
        let difference = 0;
        if (view === 'phase1' && player.userId && playerHistoricalRecords.has(player.userId)) {
            const historicalBest = playerHistoricalRecords.get(player.userId);
            difference = player.score - historicalBest;

            // Pokazuj strzałki tylko jeśli historyczny rekord > 0
            if (difference > 0 && historicalBest > 0) {
                // Nowy rekord - użyj indeksu górnego (superscript) z trójkątem
                const superscriptMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
                const superscriptNumber = ('' + difference).split('').map(c => superscriptMap[c] || c).join('');
                progressText = ` ▲${superscriptNumber}`;
            } else if (difference < 0 && player.score > 0) {
                // Poniżej rekordu - użyj indeksu dolnego (subscript) z trójkątem - tylko jeśli wynik > 0
                const subscriptMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };
                const subscriptNumber = ('' + Math.abs(difference)).split('').map(c => subscriptMap[c] || c).join('');
                progressText = ` ▼${subscriptNumber}`;
            }

            // Zapisz dane do TOP3 tylko jeśli historyczny rekord > 0
            if (historicalBest > 0) {
                playerProgressData.push({
                    displayName: player.displayName,
                    difference: difference,
                    userId: player.userId,
                    score: player.score
                });
            }
        }

        return `${progressBar} ${position}. ${displayName} - ${player.score}${progressText}`;
    }).join('\n');

    // Dla Fazy 1: oblicz TOP3 progresów i regresów
    let top3Section = '';
    if (view === 'phase1' && playerProgressData.length > 0) {
        // TOP3 najlepsze progresy (największe dodatnie wartości)
        const topProgress = [...playerProgressData]
            .filter(p => p.difference > 0)
            .sort((a, b) => b.difference - a.difference)
            .slice(0, 3);

        // TOP3 największe regresy (największe ujemne wartości) - wykluczamy osoby z wynikiem 0
        const topRegress = [...playerProgressData]
            .filter(p => p.difference < 0 && p.score > 0)
            .sort((a, b) => a.difference - b.difference)
            .slice(0, 3);

        if (topProgress.length > 0 || topRegress.length > 0) {
            top3Section = '\n\n';

            // Oblicz sumę wszystkich progresów i regresów
            const totalProgressSum = playerProgressData
                .filter(p => p.difference > 0)
                .reduce((sum, p) => sum + p.difference, 0);

            const totalRegressSum = playerProgressData
                .filter(p => p.difference < 0 && p.score > 0)
                .reduce((sum, p) => sum + Math.abs(p.difference), 0);

            if (topProgress.length > 0) {
                top3Section += '**🏆 TOP3 Progres:**\n';
                topProgress.forEach((p, idx) => {
                    const isCaller = p.userId === interaction.user.id;
                    const displayName = isCaller ? `**${p.displayName}**` : p.displayName;
                    const emoji = isCaller ? ' <a:PepeOklaski:1259556219312410760>' : '';
                    top3Section += `${idx + 1}. ${displayName} (+${p.difference})${emoji}\n`;
                });

                if (totalProgressSum > 0) {
                    top3Section += `**Suma progresu:** +${totalProgressSum.toLocaleString('pl-PL')} pkt\n`;
                }
            }

            if (topRegress.length > 0) {
                if (topProgress.length > 0) top3Section += '\n';
                top3Section += '**💀 TOP3 Regres:**\n';
                topRegress.forEach((p, idx) => {
                    const isCaller = p.userId === interaction.user.id;
                    const displayName = isCaller ? `**${p.displayName}**` : p.displayName;
                    const emoji = isCaller ? ' <:PFrogLaczek:1425166409461268510>' : '';
                    top3Section += `${idx + 1}. ${displayName} (${p.difference})${emoji}\n`;
                });

                if (totalRegressSum > 0) {
                    top3Section += `**Suma regresu:** -${totalRegressSum.toLocaleString('pl-PL')} pkt\n`;
                }
            }
        }
    }

    // Kanały, na których wiadomości z /wyniki nie będą automatycznie usuwane
    const permanentChannels = [
        '1185510890930458705',
        '1200055492458856458',
        '1200414388327292938',
        '1262792522497921084'
    ];

    // Specjalne wątki (bez auto-usuwania)
    const permanentThreads = [
        '1346401063858606092'  // Wątek w specjalnym kanale
    ];

    // Sprawdź czy to specjalny kanał lub wątek w specjalnym kanale
    const currentChannelId = interaction.channelId;
    const parentChannelId = interaction.channel?.parentId || interaction.channel?.parent?.id;
    const isPermanentChannel = permanentChannels.includes(currentChannelId) ||
                               (parentChannelId && permanentChannels.includes(parentChannelId)) ||
                               permanentThreads.includes(currentChannelId);

    // Oblicz timestamp usunięcia (15 minut od teraz - zawsze resetuj przy każdym kliknięciu)
    const messageCleanupService = interaction.client.messageCleanupService;
    const shouldAutoDelete = !isPermanentChannel;
    const deleteAt = shouldAutoDelete ? Date.now() + (15 * 60 * 1000) : null;
    const deleteTimestamp = deleteAt ? Math.floor(deleteAt / 1000) : null;

    // Opis z informacją o wygaśnięciu - NIE pokazuj na specjalnych kanałach/wątkach
    const expiryInfo = (shouldAutoDelete && deleteTimestamp) ? `\n\n⏱️ Wygasa: <t:${deleteTimestamp}:R>` : '';

    // Pobierz displayName osoby oglądającej
    const viewerDisplayName = interaction.member?.displayName || interaction.user.username;

    const embed = new EmbedBuilder()
        .setTitle(`📊 Wyniki - ${viewTitle}`)
        .setDescription(`**Klan:** ${clanName}\n**Tydzień:** ${weekNumber}/${year}\n${descriptionExtra}\n${resultsText}${top3Section}${expiryInfo}`)
        .setColor('#0099FF')
        .setFooter({ text: `Łącznie graczy: ${sortedPlayers.length} | Zapisano: ${new Date(weekData.createdAt).toLocaleDateString('pl-PL')} | Ogląda: ${viewerDisplayName}` })
        .setTimestamp();

    // Przyciski nawigacji między fazami
    const navRow = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|phase1`)
                .setLabel('Faza 1')
                .setStyle(view === 'phase1' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase1),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round1`)
                .setLabel('Runda 1')
                .setStyle(view === 'round1' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[0]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round2`)
                .setLabel('Runda 2')
                .setStyle(view === 'round2' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[1]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|round3`)
                .setLabel('Runda 3')
                .setStyle(view === 'round3' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2?.rounds?.[2]),
            new ButtonBuilder()
                .setCustomId(`wyniki_view|${clan}|${weekNumber}-${year}|summary`)
                .setLabel('Suma Faza 2')
                .setStyle(view === 'summary' ? ButtonStyle.Primary : ButtonStyle.Secondary)
                .setDisabled(!weekDataPhase2)
        );

    // Sprawdź czy istnieje zdjęcie z tabelą wyników (dla wszystkich widoków)
    let imageAttachment = null;
    const fs = require('fs').promises;
    const path = require('path');
    const { AttachmentBuilder } = require('discord.js');

    const phaseDir = path.join(
        __dirname,
        '../data/phases',
        `guild_${interaction.guild.id}`,
        'phase2',
        year.toString()
    );

    // Szukaj pliku ze zdjęciem (różne rozszerzenia)
    const possibleExtensions = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

    for (const ext of possibleExtensions) {
        const imagePath = path.join(phaseDir, `week-${weekNumber}_${clan}_table.${ext}`);
        try {
            await fs.access(imagePath);
            // Plik istnieje - stwórz attachment
            imageAttachment = new AttachmentBuilder(imagePath, { name: `table.${ext}` });
            embed.setImage(`attachment://table.${ext}`);
            break;
        } catch (error) {
            // Plik nie istnieje - spróbuj następne rozszerzenie
            continue;
        }
    }

    const replyOptions = {
        embeds: [embed],
        components: [navRow]
    };

    if (imageAttachment) {
        replyOptions.files = [imageAttachment];
    }

    let response;
    if (useFollowUp) {
        // Dla /wyniki - wyślij publiczną wiadomość
        await interaction.editReply({
            content: '✅ Wyniki zostały wysłane publicznie poniżej.',
            embeds: [],
            components: []
        });
        response = await interaction.followUp(replyOptions);
    } else if (isUpdate) {
        // Dla przycisków nawigacji
        response = await interaction.update(replyOptions);
    } else {
        // Dla innych komend (widoczne tylko dla wywołującego)
        response = await interaction.editReply(replyOptions);
    }

    // Zaplanuj usunięcie wiadomości po 15 minutach (resetuj timer przy każdym kliknięciu)
    // Dla update, message jest w interaction.message
    // Dla followUp/editReply, message jest w response
    const messageToSchedule = (isUpdate || useFollowUp) ? (isUpdate ? interaction.message : response) : response;

    if (messageToSchedule && messageCleanupService && shouldAutoDelete) {
        // Usuń stary scheduled deletion jeśli istnieje
        if (isUpdate) {
            await messageCleanupService.removeScheduledMessage(messageToSchedule.id);
        }

        // Dodaj nowy scheduled deletion z nowym czasem (15 minut od teraz)
        await messageCleanupService.scheduleMessageDeletion(
            messageToSchedule.id,
            messageToSchedule.channelId,
            deleteAt,
            interaction.user.id
        );
    } else if (messageToSchedule && messageCleanupService && !shouldAutoDelete) {
        // Jeśli kanał jest na liście permanentnych, usuń zaplanowane usunięcie (jeśli istnieje)
        if (isUpdate) {
            await messageCleanupService.removeScheduledMessage(messageToSchedule.id);
        }
    }
}

// Funkcja obsługująca autocomplete
async function handleAutocomplete(interaction, sharedState) {
    const { databaseService, config } = sharedState;

    try {
        if (interaction.commandName === 'progres' || interaction.commandName === 'player-status') {
            const focusedValue = interaction.options.getFocused();
            const focusedValueLower = focusedValue.toLowerCase();

            // Szybkie zabezpieczenie przed timeout (3s limit Discord)
            const timeout = setTimeout(() => {
                logger.warn('[AUTOCOMPLETE] ⚠️ Timeout - odpowiadam pustą listą');
                interaction.respond([]).catch(() => {}); // Ignoruj błędy jeśli już odpowiedzieliśmy
            }, 2500); // 2.5s - bezpieczny margines

            try {
                // Pobierz indeks graczy (teraz z cache - powinno być szybkie)
                const playerIndex = await databaseService.loadPlayerIndex(interaction.guild.id);

                clearTimeout(timeout); // Anuluj timeout jeśli zdążyliśmy

                if (Object.keys(playerIndex).length === 0) {
                    await interaction.respond([]);
                    return;
                }

                // Zbierz tylko najnowsze nicki graczy
                const playerNames = Object.values(playerIndex).map(data => data.latestNick);

                // Filtruj i sortuj graczy według dopasowania
                const choices = playerNames
                    .filter(name => name.toLowerCase().includes(focusedValueLower))
                    .sort((a, b) => {
                        // Sortuj: najpierw ci którzy zaczynają się od wpisanego tekstu
                        const aLower = a.toLowerCase();
                        const bLower = b.toLowerCase();
                        const aStartsWith = aLower.startsWith(focusedValueLower);
                        const bStartsWith = bLower.startsWith(focusedValueLower);

                        if (aStartsWith && !bStartsWith) return -1;
                        if (!aStartsWith && bStartsWith) return 1;

                        // Jeśli oba zaczynają się lub oba nie zaczynają się, sortuj alfabetycznie
                        return aLower.localeCompare(bLower);
                    })
                    .map(name => ({
                        name: name,
                        value: name
                    }))
                    .slice(0, 24); // Discord limit: max 25 opcji (zostawiamy miejsce na opcję "użyj wpisanego")

                // Jeśli użytkownik coś wpisał i nie ma dokładnego dopasowania, dodaj opcję "użyj tego co wpisałem"
                if (focusedValue.length > 0 && !choices.find(c => c.value.toLowerCase() === focusedValueLower)) {
                    choices.unshift({
                        name: `📝 Użyj wpisanego: "${focusedValue}"`,
                        value: focusedValue
                    });
                }

                await interaction.respond(choices);
            } catch (innerError) {
                clearTimeout(timeout);
                throw innerError; // Rzuć dalej do głównego catch
            }
        }
    } catch (error) {
        logger.error('[AUTOCOMPLETE] ❌ Błąd obsługi autocomplete:', error);
        // Próba odpowiedzi pustą listą (może się nie udać jeśli timeout)
        try {
            await interaction.respond([]);
        } catch (respondError) {
            // Ignoruj błąd - prawdopodobnie już odpowiedzieliśmy lub interakcja wygasła
        }
    }
}

// Funkcja obsługująca przyciski nawigacji między graczami
async function handleProgresNavButton(interaction, sharedState) {
    const { databaseService } = sharedState;

    // Sprawdź czy użytkownik który kliknął to ten sam który wywołał komendę
    const customIdParts = interaction.customId.split('|');
    const ownerId = customIdParts[1];
    const playerName = customIdParts[2];

    if (interaction.user.id !== ownerId) {
        await interaction.reply({
            content: '❌ Tylko osoba która wywołała komendę może zmieniać gracza.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Defer reply (wysyłamy nową wiadomość)
    await interaction.deferReply();

    try {
        // Pobierz wszystkie tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.followUp({
                content: '❌ Brak zapisanych wyników.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Usuń starą wiadomość i wyświetl nową
        const messageCleanupService = interaction.client.messageCleanupService;
        if (interaction.message && messageCleanupService) {
            // Usuń scheduled deletion dla starej wiadomości
            await messageCleanupService.removeScheduledMessage(interaction.message.id);

            try {
                await interaction.message.delete();
            } catch (error) {
                logger.warn('[PROGRES] Nie udało się usunąć starej wiadomości');
            }
        }

        // Wyświetl progres nowego gracza
        await showPlayerProgress(interaction, playerName, ownerId, sharedState);

    } catch (error) {
        logger.error('[PROGRES] ❌ Błąd nawigacji:', error);
        await interaction.followUp({
            content: '❌ Wystąpił błąd podczas zmiany gracza.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Funkcja tworząca ranking graczy po all-time max
async function createAllTimeRanking(guildId, databaseService, last54Weeks) {
    // Mapa: userId -> { latestNick, maxScore }
    const playerMaxScores = new Map();

    for (const week of last54Weeks) {
        for (const clan of week.clans) {
            const weekData = await databaseService.getPhase1Results(
                guildId,
                week.weekNumber,
                week.year,
                clan
            );

            if (weekData && weekData.players) {
                weekData.players.forEach(player => {
                    if (player.userId && player.score > 0) {
                        const current = playerMaxScores.get(player.userId);
                        if (!current || player.score > current.maxScore) {
                            playerMaxScores.set(player.userId, {
                                latestNick: player.displayName,
                                maxScore: player.score
                            });
                        }
                    }
                });
            }
        }
    }

    // Konwertuj do tablicy i posortuj po maxScore (malejąco - najlepsi na początku)
    const ranking = Array.from(playerMaxScores.entries())
        .map(([userId, data]) => ({
            userId,
            playerName: data.latestNick,
            maxScore: data.maxScore
        }))
        .sort((a, b) => b.maxScore - a.maxScore);

    return ranking;
}

// Funkcja wyświetlająca progres gracza
async function showPlayerProgress(interaction, selectedPlayer, ownerId, sharedState) {
    const { config, databaseService } = sharedState;

    try {

        // Znajdź userId dla wybranego nicku (może być stary lub nowy nick)
        const userInfo = await databaseService.findUserIdByNick(interaction.guild.id, selectedPlayer);

        if (!userInfo) {
            // Fallback - nie znaleziono w indeksie, nie ma danych
            await interaction.followUp({
                content: `❌ Nie znaleziono żadnych wyników dla gracza **${selectedPlayer}**.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const { userId, latestNick } = userInfo;

        // Pobierz wszystkie dostępne tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);
        const last54Weeks = allWeeks.slice(0, 54);

        // Zbierz dane gracza ze wszystkich tygodni i klanów (po userId, nie po nicku)
        const playerProgressData = [];

        for (const week of last54Weeks) {
            for (const clan of week.clans) {
                const weekData = await databaseService.getPhase1Results(
                    interaction.guild.id,
                    week.weekNumber,
                    week.year,
                    clan
                );

                if (weekData && weekData.players) {
                    const player = weekData.players.find(p => p.userId === userId);

                    if (player) {
                        playerProgressData.push({
                            weekNumber: week.weekNumber,
                            year: week.year,
                            clan: clan,
                            clanName: config.roleDisplayNames[clan],
                            score: player.score,
                            displayName: player.displayName,
                            createdAt: weekData.createdAt
                        });
                        break;
                    }
                }
            }
        }

        if (playerProgressData.length === 0) {
            await interaction.followUp({
                content: `❌ Nie znaleziono żadnych wyników dla gracza **${latestNick}**.`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Posortuj dane od najnowszych do najstarszych
        playerProgressData.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        // Oblicz skumulowany progres/regres (duże liczby dla skumulowanych wartości)
        const formatDifference = (difference) => {
            if (difference > 0) {
                return `▲ ${difference.toLocaleString('pl-PL')}`;
            } else if (difference < 0) {
                return `▼ ${Math.abs(difference).toLocaleString('pl-PL')}`;
            }
            return '━';
        };

        // Małe liczby dla progress barów (tydzień do tygodnia)
        const superscriptMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
        const subscriptMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

        const formatSmallDifference = (difference) => {
            if (difference > 0) {
                const superscriptNumber = ('' + difference).split('').map(c => superscriptMap[c] || c).join('');
                return ` ▲${superscriptNumber}`;
            } else if (difference < 0) {
                const subscriptNumber = ('' + Math.abs(difference)).split('').map(c => subscriptMap[c] || c).join('');
                return ` ▼${subscriptNumber}`;
            }
            return '';
        };

        let cumulativeSection = '';

        // Wyświetl dostępne dane nawet jeśli jest ich mniej niż idealnie
        if (playerProgressData.length >= 2) {
            // Miesiąc (idealnie 4 tygodnie, ale pokaż co jest dostępne)
            if (playerProgressData.length >= 4) {
                // POPRAWKA: Weź najwyższy wynik z ostatnich 4 tygodni
                const last4Weeks = playerProgressData.slice(0, 4);
                const maxScore = Math.max(...last4Weeks.map(d => d.score));
                const diff = maxScore - playerProgressData[3].score;
                cumulativeSection += `**🔹 Miesiąc (4 tyg):** ${formatDifference(diff)}\n`;
            } else if (playerProgressData.length >= 2) {
                const weeksCount = playerProgressData.length - 1;
                // POPRAWKA: Weź najwyższy wynik ze wszystkich dostępnych
                const allScores = playerProgressData.map(d => d.score);
                const maxScore = Math.max(...allScores);
                const diff = maxScore - playerProgressData[weeksCount].score;
                cumulativeSection += `**🔹 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }

            // Kwartał (idealnie 13 tygodni)
            if (playerProgressData.length >= 13) {
                // POPRAWKA: Weź najwyższy wynik z ostatnich 13 tygodni
                const last13Weeks = playerProgressData.slice(0, 13);
                const maxScore = Math.max(...last13Weeks.map(d => d.score));
                const diff = maxScore - playerProgressData[12].score;
                cumulativeSection += `**🔷 Kwartał (13 tyg):** ${formatDifference(diff)}\n`;
            } else if (playerProgressData.length >= 8) {
                const weeksCount = Math.min(12, playerProgressData.length - 1);
                // POPRAWKA: Weź najwyższy wynik z dostępnych
                const availableWeeks = playerProgressData.slice(0, weeksCount + 1);
                const maxScore = Math.max(...availableWeeks.map(d => d.score));
                const diff = maxScore - playerProgressData[weeksCount].score;
                cumulativeSection += `**🔷 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }

            // Pół roku (idealnie 26 tygodni)
            if (playerProgressData.length >= 26) {
                // POPRAWKA: Weź najwyższy wynik z ostatnich 26 tygodni
                const last26Weeks = playerProgressData.slice(0, 26);
                const maxScore = Math.max(...last26Weeks.map(d => d.score));
                const diff = maxScore - playerProgressData[25].score;
                cumulativeSection += `**🔶 Pół roku (26 tyg):** ${formatDifference(diff)}\n`;
            } else if (playerProgressData.length >= 14) {
                const weeksCount = Math.min(25, playerProgressData.length - 1);
                // POPRAWKA: Weź najwyższy wynik z dostępnych
                const availableWeeks = playerProgressData.slice(0, weeksCount + 1);
                const maxScore = Math.max(...availableWeeks.map(d => d.score));
                const diff = maxScore - playerProgressData[weeksCount].score;
                cumulativeSection += `**🔶 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }
        }

        if (cumulativeSection) {
            cumulativeSection += '\n';
        }

        // Oblicz maksymalny wynik dla progress bara (do skalowania)
        const maxScore = Math.max(...playerProgressData.map(d => d.score));

        // Stwórz mapę wyników gracza dla szybkiego dostępu
        const playerScoreMap = new Map();
        playerProgressData.forEach(data => {
            const key = `${data.weekNumber}-${data.year}`;
            playerScoreMap.set(key, data.score);
        });

        // Przygotuj tekst z wynikami - iteruj po WSZYSTKICH 54 tygodniach
        const barLength = 10;
        const resultsLines = [];

        for (let i = 0; i < last54Weeks.length; i++) {
            const week = last54Weeks[i];
            const weekKey = `${week.weekNumber}-${week.year}`;
            const score = playerScoreMap.get(weekKey);
            const weekLabel = `${String(week.weekNumber).padStart(2, '0')}/${String(week.year).slice(-2)}`;

            // Oblicz najlepszy wynik z POPRZEDNICH (wcześniejszych) tygodni
            // last54Weeks jest posortowane od najnowszych do najstarszych
            // więc dla tygodnia i, wcześniejsze tygodnie to j > i
            let bestScoreUpToNow = 0;
            for (let j = i + 1; j < last54Weeks.length; j++) {
                const pastWeek = last54Weeks[j];
                const pastWeekKey = `${pastWeek.weekNumber}-${pastWeek.year}`;
                const pastScore = playerScoreMap.get(pastWeekKey);
                if (pastScore !== undefined && pastScore > bestScoreUpToNow) {
                    bestScoreUpToNow = pastScore;
                }
            }

            if (score !== undefined) {
                // Gracz ma dane z tego tygodnia - pokaż normalny pasek
                const filledLength = score > 0 ? Math.max(1, Math.round((score / maxScore) * barLength)) : 0;
                const progressBar = score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

                // Oblicz różnicę względem najlepszego wyniku DO TEGO MOMENTU
                let differenceText = '';
                if (bestScoreUpToNow > 0 && score !== bestScoreUpToNow) {
                    const difference = score - bestScoreUpToNow;
                    differenceText = formatSmallDifference(difference);
                }

                resultsLines.push(`${progressBar} ${weekLabel} - ${score.toLocaleString('pl-PL')}${differenceText}`);
            } else {
                // Gracz nie ma danych z tego tygodnia - pokaż pusty pasek bez wartości
                const progressBar = '░'.repeat(barLength);
                resultsLines.push(`${progressBar} ${weekLabel} - `);
            }
        }

        const resultsText = resultsLines.join('\n');

        // Stwórz ranking all-time i znajdź pozycję gracza (po userId)
        const allTimeRanking = await createAllTimeRanking(interaction.guild.id, databaseService, last54Weeks);
        const currentPlayerIndex = allTimeRanking.findIndex(p => p.userId === userId);

        // Gracze sąsiedzi w rankingu (lepszy i gorszy)
        const betterPlayer = currentPlayerIndex > 0 ? allTimeRanking[currentPlayerIndex - 1] : null;
        const worsePlayer = currentPlayerIndex < allTimeRanking.length - 1 ? allTimeRanking[currentPlayerIndex + 1] : null;

        // Stwórz przyciski nawigacji
        const navigationButtons = [];

        if (betterPlayer) {
            const betterButton = new ButtonBuilder()
                .setCustomId(`progres_nav_better|${ownerId}|${betterPlayer.playerName}`)
                .setLabel(`◀ ${betterPlayer.playerName}`)
                .setStyle(ButtonStyle.Secondary);
            navigationButtons.push(betterButton);
        }

        if (worsePlayer) {
            const worseButton = new ButtonBuilder()
                .setCustomId(`progres_nav_worse|${ownerId}|${worsePlayer.playerName}`)
                .setLabel(`${worsePlayer.playerName} ▶`)
                .setStyle(ButtonStyle.Secondary);
            navigationButtons.push(worseButton);
        }

        const components = [];
        if (navigationButtons.length > 0) {
            const navRow = new ActionRowBuilder().addComponents(navigationButtons);
            components.push(navRow);
        }

        // Kanały permanentne
        const permanentChannels = [
            '1185510890930458705',
            '1200055492458856458',
            '1200414388327292938',
            '1262792522497921084'
        ];

        const permanentThreads = ['1346401063858606092'];

        const currentChannelId = interaction.channelId;
        const parentChannelId = interaction.channel?.parentId || interaction.channel?.parent?.id;
        const isPermanentChannel = permanentChannels.includes(currentChannelId) ||
                                   (parentChannelId && permanentChannels.includes(parentChannelId)) ||
                                   permanentThreads.includes(currentChannelId);

        const messageCleanupService = interaction.client.messageCleanupService;
        const shouldAutoDelete = !isPermanentChannel;
        const deleteAt = shouldAutoDelete ? Date.now() + (5 * 60 * 1000) : null;
        const deleteTimestamp = deleteAt ? Math.floor(deleteAt / 1000) : null;

        const expiryInfo = (shouldAutoDelete && deleteTimestamp) ? `\n\n⏱️ Wygasa: <t:${deleteTimestamp}:R>` : '';

        // Sprawdź aktualny klan gracza (czy ma obecnie rolę klanową)
        let playerClan = 'Poza strukturami';
        try {
            const member = await interaction.guild.members.fetch(userId);
            if (member) {
                // Sprawdź która rola klanowa ma gracz
                for (const [clanKey, roleId] of Object.entries(config.targetRoles)) {
                    if (member.roles.cache.has(roleId)) {
                        playerClan = config.roleDisplayNames[clanKey];
                        break;
                    }
                }
            }
        } catch (fetchError) {
            // Gracz nie jest już na serwerze
            playerClan = 'Poza strukturami';
        }

        // Użyj najnowszego nicku z danych
        const displayNick = playerProgressData.length > 0 ? playerProgressData[0].displayName : latestNick;

        const embed = new EmbedBuilder()
            .setTitle(`📈 Progres gracza: ${displayNick} (${playerClan})`)
            .setDescription(`${cumulativeSection}**Wyniki z Fazy 1** (ostatnie ${last54Weeks.length} tygodni):\n\n${resultsText}${expiryInfo}`)
            .setColor('#00FF00')
            .setFooter({ text: `Tygodni z danymi: ${playerProgressData.length}/${last54Weeks.length} | Najlepszy wynik: ${maxScore.toLocaleString('pl-PL')}` })
            .setTimestamp();

        const response = await interaction.editReply({
            embeds: [embed],
            components: components
        });

        // Zaplanuj usunięcie wiadomości
        if (response && messageCleanupService && shouldAutoDelete) {
            await messageCleanupService.scheduleMessageDeletion(
                response.id,
                response.channelId,
                deleteAt,
                ownerId
            );
        }

    } catch (error) {
        logger.error('[PROGRES] ❌ Błąd wyświetlania progresu:', error);
        await interaction.followUp({
            content: '❌ Wystąpił błąd podczas pobierania danych progresu.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Funkcja obsługująca komendę /progres
async function handleProgresCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = Object.values(config.targetRoles);
    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/progres` jest dostępna tylko dla członków klanu.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!allowedChannels.includes(interaction.channelId) && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: `❌ Komenda \`/progres\` jest dostępna tylko na określonych kanałach.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Pobierz nick z parametru
        const selectedPlayer = interaction.options.getString('nick');

        // Pobierz wszystkie dostępne tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.editReply({
                content: '❌ Brak zapisanych wyników. Użyj `/faza1` aby rozpocząć zbieranie danych.'
            });
            return;
        }

        // Wyświetl progres gracza
        await showPlayerProgress(interaction, selectedPlayer, interaction.user.id, sharedState);

    } catch (error) {
        logger.error('[PROGRES] ❌ Błąd wyświetlania progresu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania danych progresu.'
        });
    }
}

// Funkcja obsługująca komendę /player-status
async function handlePlayerStatusCommand(interaction, sharedState) {
    const { config, databaseService, reminderUsageService } = sharedState;

    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = Object.values(config.targetRoles);
    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/player-status` jest dostępna tylko dla członków klanu.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!allowedChannels.includes(interaction.channelId) && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: `❌ Komenda \`/player-status\` jest dostępna tylko na określonych kanałach.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Pobierz nick z parametru
        const selectedPlayer = interaction.options.getString('nick');

        // Znajdź userId dla wybranego nicku
        const userInfo = await databaseService.findUserIdByNick(interaction.guild.id, selectedPlayer);

        if (!userInfo) {
            await interaction.editReply({
                content: `❌ Nie znaleziono żadnych wyników dla gracza **${selectedPlayer}**.`
            });
            return;
        }

        const { userId, latestNick } = userInfo;

        // Pobierz wszystkie dostępne tygodnie (ostatnie 12)
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.editReply({
                content: '❌ Brak zapisanych wyników. Użyj `/faza1` aby rozpocząć zbieranie danych.'
            });
            return;
        }

        const last12Weeks = allWeeks.slice(0, 12);

        // Zbierz dane gracza ze wszystkich tygodni i klanów (ostatnie 12 tygodni)
        const playerProgressData = [];

        for (const week of last12Weeks) {
            for (const clan of week.clans) {
                const weekData = await databaseService.getPhase1Results(
                    interaction.guild.id,
                    week.weekNumber,
                    week.year,
                    clan
                );

                if (weekData && weekData.players) {
                    const player = weekData.players.find(p => p.userId === userId);

                    if (player) {
                        playerProgressData.push({
                            weekNumber: week.weekNumber,
                            year: week.year,
                            clan: clan,
                            clanName: config.roleDisplayNames[clan],
                            score: player.score,
                            displayName: player.displayName,
                            createdAt: weekData.createdAt
                        });
                        break;
                    }
                }
            }
        }

        if (playerProgressData.length === 0) {
            await interaction.editReply({
                content: `❌ Nie znaleziono żadnych wyników dla gracza **${latestNick}** w ostatnich 12 tygodniach.`
            });
            return;
        }

        // Posortuj dane od najnowszych do najstarszych
        playerProgressData.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        // Pobierz obecny klan gracza i jego członka Discord
        const members = await interaction.guild.members.fetch();
        const member = members.get(userId);

        let currentClan = null;
        let currentClanKey = null;

        if (member) {
            for (const [clanKey, roleId] of Object.entries(config.targetRoles)) {
                if (member.roles.cache.has(roleId)) {
                    currentClan = config.roleDisplayNames[clanKey];
                    currentClanKey = clanKey;
                    break;
                }
            }
        }

        // Jeśli nie ma klanu, użyj info z najnowszych danych lub "Aktualnie poza strukturami"
        if (!currentClan && playerProgressData.length > 0) {
            currentClan = playerProgressData[0].clanName;
            currentClanKey = playerProgressData[0].clan;
        }

        const clanDisplay = currentClan || 'Aktualnie poza strukturami';

        // Oblicz globalną pozycję w rankingu
        const last54Weeks = allWeeks.slice(0, 54); // Dla globalnego rankingu używamy 54 tygodni
        const globalRanking = await createGlobalPlayerRanking(
            interaction.guild,
            databaseService,
            config,
            last54Weeks,
            members  // Przekaż już pobrane members
        );

        // ZMIANA: Szukaj po userId zamiast nicku
        const globalPosition = globalRanking.findIndex(p => p.userId === userId) + 1;
        const totalPlayers = globalRanking.length;

        // Oblicz pozycję w klanie (jeśli ma klan)
        let clanPosition = null;
        let clanTotalPlayers = null;

        if (currentClanKey) {
            const clanRanking = globalRanking.filter(p => p.clanKey === currentClanKey);
            // ZMIANA: Szukaj po userId zamiast nicku
            clanPosition = clanRanking.findIndex(p => p.userId === userId) + 1;
            clanTotalPlayers = clanRanking.length;
        }

        // Pobierz dane o karach
        const guildPunishments = await databaseService.getGuildPunishments(interaction.guild.id);
        const userPunishment = guildPunishments[userId];
        const lifetimePoints = userPunishment ? (userPunishment.lifetime_points || 0) : 0;

        // Sprawdź role
        const hasPunishmentRole = member ? member.roles.cache.has(config.punishmentRoleId) : false;
        const hasLotteryBanRole = member ? member.roles.cache.has(config.lotteryBanRoleId) : false;

        // Pobierz dane o przypomnieniach i potwierdzeniach
        await reminderUsageService.loadUsageData();
        const reminderData = reminderUsageService.usageData;
        const confirmations = await loadConfirmations(config);

        // Całkowite liczby (z całej historii) - do wyświetlenia w sekcji "Kary i Status"
        const reminderCountTotal = reminderData.receivers?.[userId]?.totalPings || 0;
        const confirmationCountTotal = confirmations.userStats?.[userId]?.totalConfirmations || 0;

        // Helper do obliczania różnicy tygodni
        const getWeeksDifference = (weekNum1, year1, weekNum2, year2) => {
            if (year1 === year2) {
                return weekNum1 - weekNum2;
            } else {
                // Przejście między latami (przybliżone - zakładamy 52 tygodnie w roku)
                return (year1 - year2) * 52 + (weekNum1 - weekNum2);
            }
        };

        // Oblicz zakres dat dla ostatnich 12 tygodni (tylko do współczynników)
        const numberOfWeeksWithData = playerProgressData.length;
        let reminderCountLast12Weeks = 0;
        let confirmationCountLast12Weeks = 0;
        let reminderCountForReliability = 0;  // Dla Rzetelności i Punktualności (próg 45/2025)
        let reminderCountForResponsiveness = 0;  // Dla Responsywności - pingi (próg 49/2025)
        let confirmationCountForResponsiveness = 0;  // Dla Responsywności - potwierdzenia (próg 49/2025)

        // Dla Rzetelności i Punktualności - filtr 45/2025
        const weeksSince45_2025 = playerProgressData.filter(data => {
            return data.year > 2025 || (data.year === 2025 && data.weekNumber >= 45);
        }).length;

        // Dla Responsywności - filtr 49/2025
        const weeksSince49_2025 = playerProgressData.filter(data => {
            return data.year > 2025 || (data.year === 2025 && data.weekNumber >= 49);
        }).length;

        if (numberOfWeeksWithData > 0) {
            // Znajdź najstarszy i najnowszy tydzień w danych gracza
            const oldestWeek = playerProgressData[playerProgressData.length - 1];
            const newestWeek = playerProgressData[0];

            // Sprawdź czy używać progów 45/2025 i 49/2025
            const weeksSinceThreshold45 = getWeeksDifference(newestWeek.weekNumber, newestWeek.year, 45, 2025);
            const weeksSinceThreshold49 = getWeeksDifference(newestWeek.weekNumber, newestWeek.year, 49, 2025);

            const useThreshold45 = weeksSinceThreshold45 < 12 && (oldestWeek.year < 2025 || (oldestWeek.year === 2025 && oldestWeek.weekNumber < 45));
            const useThreshold49 = weeksSinceThreshold49 < 12 && (oldestWeek.year < 2025 || (oldestWeek.year === 2025 && oldestWeek.weekNumber < 49));

            // Oblicz przybliżone daty dla zakresu (używamy początku tygodnia)
            const getWeekStartDate = (weekNumber, year) => {
                // Przybliżone obliczenie: 1 stycznia + (numer_tygodnia - 1) * 7 dni
                const date = new Date(year, 0, 1);
                const dayOfWeek = date.getDay();
                const diff = (weekNumber - 1) * 7 - (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
                date.setDate(date.getDate() + diff);
                return date;
            };

            const startDate = getWeekStartDate(oldestWeek.weekNumber, oldestWeek.year);
            const startDate45 = useThreshold45 ? getWeekStartDate(45, 2025) : startDate;
            const startDate49 = useThreshold49 ? getWeekStartDate(49, 2025) : startDate;
            const endDate = new Date(); // Do dzisiaj

            // Konwertuj na format YYYY-MM-DD dla porównań
            const formatDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const startDateStr = formatDate(startDate);
            const startDate45Str = formatDate(startDate45);
            const startDate49Str = formatDate(startDate49);

            // Zlicz pingi z różnych zakresów
            if (reminderData.receivers && reminderData.receivers[userId]) {
                const userPings = reminderData.receivers[userId].dailyPings || {};

                for (const dateStr in userPings) {
                    // Dla ostatnich 12 tygodni (Zaangażowanie)
                    if (dateStr >= startDateStr) {
                        reminderCountLast12Weeks += userPings[dateStr].length;
                    }
                    // Dla Rzetelności i Punktualności (próg 45/2025 lub 12 tygodni)
                    if (dateStr >= startDate45Str) {
                        reminderCountForReliability += userPings[dateStr].length;
                    }
                    // Dla Responsywności - pingi (próg 49/2025 lub 12 tygodni)
                    if (dateStr >= startDate49Str) {
                        reminderCountForResponsiveness += userPings[dateStr].length;
                    }
                }
            }

            // Zlicz potwierdzenia z różnych zakresów
            const startTimestamp = startDate.getTime();
            const startTimestamp45 = startDate45.getTime();
            const startTimestamp49 = startDate49.getTime();

            for (const sessionKey in confirmations.sessions) {
                const session = confirmations.sessions[sessionKey];
                const sessionDate = new Date(session.createdAt);
                const sessionTimestamp = sessionDate.getTime();

                if (session.confirmedUsers && session.confirmedUsers.includes(userId)) {
                    // Dla ostatnich 12 tygodni (Zaangażowanie)
                    if (sessionTimestamp >= startTimestamp) {
                        confirmationCountLast12Weeks++;
                    }
                    // Dla Responsywności (próg 49/2025 lub 12 tygodni)
                    if (sessionTimestamp >= startTimestamp49) {
                        confirmationCountForResponsiveness++;
                    }
                }
            }
        }

        // Oblicz współczynniki Rzetelność i Punktualność (używając progu 45/2025 jeśli dotyczy)
        let wyjebanieFactor = null;
        let timingFactor = null;

        if (weeksSince45_2025 > 0) {
            const penaltyScore = (reminderCountForReliability * 0.025) + (lifetimePoints * 0.2);
            const rawFactor = (penaltyScore / weeksSince45_2025) * 100;
            wyjebanieFactor = Math.max(0, 100 - rawFactor); // Nie może być ujemne

            // Oblicz współczynnik Timing (bez punktów kary)
            // Wzór: 100% - ((przypomnienia × 0.125) / liczba_tygodni × 100%)
            const timingPenaltyScore = reminderCountForReliability * 0.125;
            const rawTimingFactor = (timingPenaltyScore / weeksSince45_2025) * 100;
            timingFactor = Math.max(0, 100 - rawTimingFactor); // Nie może być ujemne
        }

        // Oblicz współczynnik Responsywność (używając progu 49/2025 jeśli dotyczy)
        let responsivenessFactor = null;

        if (weeksSince49_2025 > 0) {
            // Oblicz współczynnik Responsywność
            // Wzór: (liczba_potwierdzeń / liczba_pingów) × 100%
            if (reminderCountForResponsiveness > 0) {
                responsivenessFactor = (confirmationCountForResponsiveness / reminderCountForResponsiveness) * 100;
                responsivenessFactor = Math.min(100, responsivenessFactor); // Nie może być więcej niż 100%
            } else if (reminderCountForResponsiveness === 0 && confirmationCountForResponsiveness === 0) {
                // Jeśli nie było ani pingów, ani potwierdzeń - 100%
                responsivenessFactor = 100;
            } else {
                // Nie powinno się zdarzyć, ale dla bezpieczeństwa
                responsivenessFactor = 0;
            }
        }

        // Oblicz współczynnik Zaangażowanie (liczba tygodni z progresem)
        // Ten współczynnik będzie obliczony później, po analizie progresów tydzień do tygodnia
        let engagementFactor = null;

        // Oblicz progres miesięczny (idealnie ostatnie 4 tygodnie vs tydzień 5, ale pokaż co jest dostępne)
        let monthlyProgress = null;
        let monthlyProgressPercent = null;
        let monthlyWeeksCount = 0;

        if (playerProgressData.length >= 2) {
            // POPRAWKA: Weź najwyższy wynik z ostatnich 4 tygodni (lub mniej jeśli brak danych)
            let currentScore = 0;
            let comparisonScore = 0;

            if (playerProgressData.length >= 5) {
                // Idealnie: najwyższy z ostatnich 4 tygodni vs tydzień 5
                const last4Weeks = playerProgressData.slice(0, 4);
                currentScore = Math.max(...last4Weeks.map(d => d.score));
                comparisonScore = playerProgressData[4].score;
                monthlyWeeksCount = 4;
            } else {
                // Za mało danych: najwyższy z dostępnych vs najstarszy
                const allScores = playerProgressData.map(d => d.score);
                currentScore = Math.max(...allScores);
                comparisonScore = playerProgressData[playerProgressData.length - 1].score;

                // Oblicz zakres tygodni od pierwszego do ostatniego (nie liczbę tygodni z danymi)
                const firstWeek = playerProgressData[playerProgressData.length - 1];
                const lastWeek = playerProgressData[0];

                // Oblicz różnicę w tygodniach
                if (firstWeek.year === lastWeek.year) {
                    monthlyWeeksCount = lastWeek.weekNumber - firstWeek.weekNumber;
                } else {
                    // Obsługa przejścia między latami
                    const weeksInFirstYear = 52 - firstWeek.weekNumber;
                    monthlyWeeksCount = weeksInFirstYear + lastWeek.weekNumber;
                }
            }

            if (comparisonScore > 0) {
                monthlyProgress = currentScore - comparisonScore;
                monthlyProgressPercent = ((monthlyProgress / comparisonScore) * 100).toFixed(1);
            }
        }

        // Oblicz progres kwartalny (idealnie ostatnie 12 tygodni vs tydzień 13, ale pokaż co jest dostępne)
        let quarterlyProgress = null;
        let quarterlyProgressPercent = null;
        let quarterlyWeeksCount = 0;

        const allWeeksForQuarterly = allWeeks.slice(0, 13);
        if (allWeeksForQuarterly.length === 13) {
            // Idealnie: mamy 13 tygodni
            // Znajdź wynik z tygodnia 13
            let week13Score = 0;

            const week13 = allWeeksForQuarterly[12];
            for (const clan of week13.clans) {
                const weekData = await databaseService.getPhase1Results(
                    interaction.guild.id,
                    week13.weekNumber,
                    week13.year,
                    clan
                );

                if (weekData && weekData.players) {
                    const player = weekData.players.find(p => p.userId === userId);
                    if (player) {
                        week13Score = player.score;
                        break;
                    }
                }
            }

            if (week13Score > 0 && playerProgressData.length > 0) {
                // POPRAWKA: Weź najwyższy wynik z ostatnich 12 tygodni
                const last12Weeks = playerProgressData.slice(0, Math.min(12, playerProgressData.length));
                const currentScore = Math.max(...last12Weeks.map(d => d.score));
                quarterlyProgress = currentScore - week13Score;
                quarterlyProgressPercent = ((quarterlyProgress / week13Score) * 100).toFixed(1);
                quarterlyWeeksCount = 12;
            }
        } else if (playerProgressData.length >= 2) {
            // Za mało danych: użyj tego co jest dostępne
            // POPRAWKA: Weź najwyższy wynik ze wszystkich dostępnych tygodni
            const allScores = playerProgressData.map(d => d.score);
            const currentScore = Math.max(...allScores);

            // Znajdź najstarszy wynik który jest > 0 (pomijamy wyniki zerowe)
            let comparisonScore = 0;
            let firstWeekIndex = -1;

            for (let i = playerProgressData.length - 1; i >= 0; i--) {
                if (playerProgressData[i].score > 0) {
                    comparisonScore = playerProgressData[i].score;
                    firstWeekIndex = i;
                    break;
                }
            }

            if (comparisonScore > 0 && firstWeekIndex !== -1) {
                quarterlyProgress = currentScore - comparisonScore;
                quarterlyProgressPercent = ((quarterlyProgress / comparisonScore) * 100).toFixed(1);

                // Oblicz zakres tygodni od pierwszego (> 0) do ostatniego
                const firstWeek = playerProgressData[firstWeekIndex];
                const lastWeek = playerProgressData[0];

                // Oblicz różnicę w tygodniach
                if (firstWeek.year === lastWeek.year) {
                    quarterlyWeeksCount = lastWeek.weekNumber - firstWeek.weekNumber;
                } else {
                    // Obsługa przejścia między latami
                    const weeksInFirstYear = 52 - firstWeek.weekNumber;
                    quarterlyWeeksCount = weeksInFirstYear + lastWeek.weekNumber;
                }
            }
        }

        // Oblicz największy progres i regres w całej historii
        let biggestProgress = null;
        let biggestProgressWeek = null;
        let biggestRegress = null;
        let biggestRegressWeek = null;

        if (playerProgressData.length >= 2) {
            let maxProgressDiff = 0;
            let maxRegressDiff = 0;
            let progressWeeksCount = 0; // Liczba tygodni z progresem

            for (let i = 0; i < playerProgressData.length; i++) {
                const currentWeek = playerProgressData[i];

                // Oblicz najlepszy wynik z POPRZEDNICH (wcześniejszych) tygodni
                // playerProgressData jest posortowane od najnowszych do najstarszych
                // więc dla tygodnia i, wcześniejsze tygodnie to j > i
                let bestScoreUpToNow = 0;
                for (let j = i + 1; j < playerProgressData.length; j++) {
                    const pastWeek = playerProgressData[j];
                    if (pastWeek.score > bestScoreUpToNow) {
                        bestScoreUpToNow = pastWeek.score;
                    }
                }

                // Oblicz różnicę względem najlepszego wyniku do tej pory
                const diff = currentWeek.score - bestScoreUpToNow;

                // Zlicz tygodnie z progresem dla współczynnika Zaangażowanie (tylko jeśli są poprzednie tygodnie)
                if (i < playerProgressData.length - 1) {
                    if (currentWeek.score === 0) {
                        // Jeśli wynik = 0, daj 0 punktów (nie dodawaj nic)
                    } else if (diff > 0) {
                        // Progres - pełny punkt
                        progressWeeksCount += 1.0;
                    } else if (diff === 0 && bestScoreUpToNow > 0) {
                        // Wyrównanie wyniku - częściowy punkt (0.8 zamiast 1.0)
                        progressWeeksCount += 0.8;
                    }
                    // diff < 0 (regres) → 0 punktów (nie dodawaj nic)
                }

                // Największy progres (dodatnia różnica od najlepszego wyniku)
                if (bestScoreUpToNow > 0 && diff > maxProgressDiff) {
                    maxProgressDiff = diff;
                    biggestProgress = diff;
                    biggestProgressWeek = `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`;
                }

                // Największy regres (ujemna różnica od najlepszego wyniku)
                if (bestScoreUpToNow > 0 && diff < maxRegressDiff) {
                    maxRegressDiff = diff;
                    biggestRegress = diff;
                    biggestRegressWeek = `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`;
                }
            }

            // Oblicz współczynnik Zaangażowanie
            // Wzór: (liczba_tygodni_z_progresem / liczba_porównań) × 100%
            const totalComparisons = playerProgressData.length - 1;
            if (totalComparisons > 0) {
                engagementFactor = (progressWeeksCount / totalComparisons) * 100;
            }
        }

        // Oblicz współczynnik Trend (tempo progresu)
        // Porównuje średnie tempo z miesiąca ze średnim tempem z dłuższego okresu (WARTOŚCI PUNKTOWE, NIE PROCENTOWE)
        let trendRatio = null;
        let trendDescription = null;
        let trendIcon = null;
        let monthlyValue = null;
        let longerTermValue = null;
        let adjustedLongerTermValue = null;

        if (monthlyProgress !== null) {

            // Scenariusz 1: Mamy pełne dane kwartalne (13 tygodni)
            if (quarterlyProgress !== null && quarterlyWeeksCount === 12) {
                // Miesięczny progres już jest za 4 tygodnie (wartość punktowa)
                monthlyValue = monthlyProgress;
                // Kwartalny progres jest za 12 tygodni, dzielimy przez 3 aby uzyskać równowartość 4 tygodni (wartość punktowa)
                longerTermValue = quarterlyProgress / 3;
            }
            // Scenariusz 2: Nie mamy pełnych danych kwartalnych, liczymy średni tygodniowy progres
            else if (playerProgressData.length >= 2) {
                // Średni tygodniowy progres z miesiąca (miesięczny progres punktowy / liczba tygodni)
                monthlyValue = monthlyProgress / (monthlyWeeksCount || 4);

                // Średni tygodniowy progres z całości (całkowity progres punktowy / liczba tygodni między pierwszym a ostatnim)
                const firstScore = playerProgressData[playerProgressData.length - 1].score;
                const lastScore = playerProgressData[0].score;

                const totalProgressPoints = lastScore - firstScore;

                // Oblicz zakres tygodni (nie liczbę tygodni z danymi, ale zakres czasowy)
                const firstWeek = playerProgressData[playerProgressData.length - 1];
                const lastWeek = playerProgressData[0];
                let totalWeeksSpan = 0;

                if (firstWeek.year === lastWeek.year) {
                    totalWeeksSpan = lastWeek.weekNumber - firstWeek.weekNumber;
                } else {
                    const weeksInFirstYear = 52 - firstWeek.weekNumber;
                    totalWeeksSpan = weeksInFirstYear + lastWeek.weekNumber;
                }

                if (totalWeeksSpan > 0) {
                    longerTermValue = totalProgressPoints / totalWeeksSpan;
                }
            }

            // Określ opis i ikonę trendu na podstawie stosunku
            if (monthlyValue !== null && longerTermValue !== null && longerTermValue !== 0) {
                // Jeżeli longerTermValue jest ujemny, traktuj go jako dodatni
                // aby uniknąć błędnej klasyfikacji trendu (dwa minusy dają plus)
                adjustedLongerTermValue = longerTermValue < 0 ? Math.abs(longerTermValue) : longerTermValue;
                trendRatio = monthlyValue / adjustedLongerTermValue;

                // Progi dla klasyfikacji trendu
                if (trendRatio >= 1.5) {
                    // Gwałtownie rosnący - miesięczny co najmniej 1.5x szybszy
                    trendDescription = 'Gwałtownie rosnący';
                    trendIcon = '🚀';
                } else if (trendRatio > 1.1) {
                    // Rosnący - miesięczny wyraźnie szybszy (powyżej 110%)
                    trendDescription = 'Rosnący';
                    trendIcon = '↗️';
                } else if (trendRatio >= 0.9) {
                    // Constans - stabilne tempo (+/-10%: 90%-110%)
                    trendDescription = 'Constans';
                    trendIcon = '⚖️';
                } else if (trendRatio > 0.5) {
                    // Malejący - miesięczny wyraźnie wolniejszy (poniżej 90%)
                    trendDescription = 'Malejący';
                    trendIcon = '↘️';
                } else {
                    // Gwałtownie malejący - miesięczny co najmniej 2x wolniejszy
                    trendDescription = 'Gwałtownie malejący';
                    trendIcon = '🪦';
                }
            }
        }

        // Stwórz wykresy progress barów (identycznie jak w /progres, ale tylko 12 tygodni)
        const maxScore = Math.max(...playerProgressData.map(d => d.score));
        const barLength = 10;

        // Stwórz mapę wyników gracza
        const playerScoreMap = new Map();
        playerProgressData.forEach(data => {
            const key = `${data.weekNumber}-${data.year}`;
            playerScoreMap.set(key, data.score);
        });

        const resultsLines = [];

        // Małe liczby dla progress barów
        const superscriptMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
        const subscriptMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

        const formatSmallDifference = (difference) => {
            if (difference > 0) {
                const superscriptNumber = ('' + difference).split('').map(c => superscriptMap[c] || c).join('');
                return ` ▲${superscriptNumber}`;
            } else if (difference < 0) {
                const subscriptNumber = ('' + Math.abs(difference)).split('').map(c => subscriptMap[c] || c).join('');
                return ` ▼${subscriptNumber}`;
            }
            return '';
        };

        // Znajdź indeks pierwszego tygodnia z danymi gracza (najstarszy tydzień z danymi)
        let firstPlayerWeekIndex = -1;
        for (let i = last12Weeks.length - 1; i >= 0; i--) {
            const week = last12Weeks[i];
            const weekKey = `${week.weekNumber}-${week.year}`;
            const score = playerScoreMap.get(weekKey);
            if (score !== undefined) {
                firstPlayerWeekIndex = i;
                break;
            }
        }

        // Jeśli gracz nie ma danych w żadnym tygodniu, pokaż wszystkie tygodnie jako puste
        if (firstPlayerWeekIndex === -1) {
            firstPlayerWeekIndex = 0;
        }

        for (let i = 0; i <= firstPlayerWeekIndex; i++) {
            const week = last12Weeks[i];
            const weekKey = `${week.weekNumber}-${week.year}`;
            const score = playerScoreMap.get(weekKey);
            const weekLabel = `${String(week.weekNumber).padStart(2, '0')}/${String(week.year).slice(-2)}`;

            // Oblicz najlepszy wynik z POPRZEDNICH (wcześniejszych) tygodni
            let bestScoreUpToNow = 0;
            for (let j = i + 1; j < last12Weeks.length; j++) {
                const pastWeek = last12Weeks[j];
                const pastWeekKey = `${pastWeek.weekNumber}-${pastWeek.year}`;
                const pastScore = playerScoreMap.get(pastWeekKey);
                if (pastScore !== undefined && pastScore > bestScoreUpToNow) {
                    bestScoreUpToNow = pastScore;
                }
            }

            if (score !== undefined) {
                const filledLength = score > 0 ? Math.max(1, Math.round((score / maxScore) * barLength)) : 0;
                const progressBar = score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

                let differenceText = '';
                if (bestScoreUpToNow > 0 && score !== bestScoreUpToNow) {
                    const difference = score - bestScoreUpToNow;
                    differenceText = formatSmallDifference(difference);
                }

                resultsLines.push(`${progressBar} ${weekLabel} - ${score.toLocaleString('pl-PL')}${differenceText}`);
            } else {
                const progressBar = '░'.repeat(barLength);
                resultsLines.push(`${progressBar} ${weekLabel} - `);
            }
        }

        const resultsText = resultsLines.join('\n');

        // Stwórz embed - wszystkie sekcje w description z nagłówkami
        let description = '';

        // Określ ikonę dla głównego nagłówka na podstawie progresu miesięcznego
        let playerIcon = '👤'; // Domyślna ikona
        if (monthlyProgressPercent !== null && parseFloat(monthlyProgressPercent) < 0) {
            playerIcon = '🧑🏻‍🦽'; // Ikona wózka dla ujemnego progresu
        }

        // Główny nagłówek
        description += `## ${playerIcon} STATUS GRACZA: ${latestNick}\n\n`;

        // Sekcja 1: Ranking
        description += `### 🏆 RANKING\n`;
        description += `🏰 **Klan:** ${globalPosition > 0 ? clanDisplay : 'Brak danych'}\n`;
        if (clanPosition && clanTotalPlayers && globalPosition > 0) {
            description += `🎖️ **Pozycja w klanie:** ${clanPosition}/${clanTotalPlayers}\n`;
        }
        description += `🌍 **Pozycja w strukturach:** ${globalPosition > 0 ? `${globalPosition}/${totalPlayers}` : 'Brak danych'}\n\n`;

        // Sekcja 2: Statystyki (tylko jeśli są dane)
        if (monthlyProgress !== null || quarterlyProgress !== null || biggestProgress !== null || biggestRegress !== null) {
            description += `### 📊 STATYSTYKI\n`;

            if (monthlyProgress !== null) {
                const arrow = monthlyProgress >= 0 ? '▲' : '▼';
                const absProgress = Math.abs(monthlyProgress).toLocaleString('pl-PL');
                const monthLabel = monthlyWeeksCount === 4 ? 'Miesiąc (4 tyg)' : `Dostępne dane (${monthlyWeeksCount} tyg)`;

                // Określ ikonę na podstawie bezwzględnej wartości progresu miesięcznego (medali)
                let monthIcon = '';
                if (monthlyProgress > 250) {
                    monthIcon = ' <a:PepeOklaski:1259556219312410760>';
                } else if (monthlyProgress > 100) {
                    monthIcon = ' <:PFrog_yes:1368668680845787156>';
                } else if (monthlyProgress > 50) {
                    monthIcon = ' <:PepeMyliciel:1278017456258027620>';
                } else {
                    monthIcon = ' <:PFrogLaczek:1425166409461268510>';
                }
                

                description += `**🔹 ${monthLabel}:** ${arrow} ${absProgress} (${monthlyProgressPercent}%)${monthIcon}\n`;
            }

            if (quarterlyProgress !== null) {
                const arrow = quarterlyProgress >= 0 ? '▲' : '▼';
                const absProgress = Math.abs(quarterlyProgress).toLocaleString('pl-PL');
                const quarterLabel = quarterlyWeeksCount === 12 ? 'Kwartał (12 tyg)' : `Dostępne dane (${quarterlyWeeksCount} tyg)`;

                // Określ ikonę na podstawie bezwzględnej wartości progresu kwartalnego (medali, 2x większe progi)
                let quarterIcon = '';
                if (quarterlyProgress > 500) {
                    quarterIcon = ' <a:PepeOklaski:1259556219312410760>';
                } else if (quarterlyProgress > 200) {
                    quarterIcon = ' <:PFrog_yes:1368668680845787156>';
                } else if (quarterlyProgress > 100) {
                    quarterIcon = ' <:PepeMyliciel:1278017456258027620>';
                } else {
                    quarterIcon = ' <:PFrogLaczek:1425166409461268510>';
                }
                

                description += `**🔷 ${quarterLabel}:** ${arrow} ${absProgress} (${quarterlyProgressPercent}%)${quarterIcon}\n`;
            }

            // Największy progres
            if (biggestProgress !== null && biggestProgress > 0) {
                const absProgress = Math.abs(biggestProgress).toLocaleString('pl-PL');
                description += `**↗️ Największy progres:** ${absProgress} (tydzień ${biggestProgressWeek})\n`;
            } else {
                description += `**↗️ Największy progres:** brak\n`;
            }

            // Największy regres
            if (biggestRegress !== null && biggestRegress < 0) {
                const absRegress = Math.abs(biggestRegress).toLocaleString('pl-PL');
                description += `**↘️ Największy regres:** ${absRegress} (tydzień ${biggestRegressWeek})\n\n`;
            } else {
                description += `**↘️ Największy regres:** brak\n\n`;
            }
        }

        // Sekcja 3: Współczynniki (zawsze pokazuj)
        description += `### 🌡️ WSPÓŁCZYNNIKI\n`;

        // Rzetelność - jeśli null, pokaż zieloną kropkę
        let reliabilityCircle = '🟢'; // Domyślnie zielone (brak danych)
        if (wyjebanieFactor !== null) {
            reliabilityCircle = '🔴'; // Czerwone (poniżej 90%)
            if (wyjebanieFactor >= 99) {
                reliabilityCircle = '🟢'; // Zielone (99%+)
            } else if (wyjebanieFactor >= 95) {
                reliabilityCircle = '🟡'; // Żółte (95-98.99%)
            } else if (wyjebanieFactor >= 90) {
                reliabilityCircle = '🟠'; // Pomarańczowe (90-94.99%)
            }
        }

        // Punktualność - jeśli null, pokaż zieloną kropkę
        let timingCircle = '🟢'; // Domyślnie zielone (brak danych)
        if (timingFactor !== null) {
            timingCircle = '🔴'; // Czerwone (poniżej 70%)
            if (timingFactor >= 90) {
                timingCircle = '🟢'; // Zielone (90%+)
            } else if (timingFactor >= 80) {
                timingCircle = '🟡'; // Żółte (80-89.99%)
            } else if (timingFactor >= 70) {
                timingCircle = '🟠'; // Pomarańczowe (70-79.99%)
            }
        }

        description += `🎯 **Rzetelność:** ${reliabilityCircle}\n⏱️ **Punktualność:** ${timingCircle}\n`;

        // Zaangażowanie - jeśli null, pokaż zieloną kropkę
        let engagementCircle = '🟢'; // Domyślnie zielone (brak danych)
        if (engagementFactor !== null) {
            engagementCircle = '🔴'; // Czerwone (poniżej 70%)
            if (engagementFactor >= 90) {
                engagementCircle = '🟢'; // Zielone (90%+)
            } else if (engagementFactor >= 80) {
                engagementCircle = '🟡'; // Żółte (80-89.99%)
            } else if (engagementFactor >= 70) {
                engagementCircle = '🟠'; // Pomarańczowe (70-79.99%)
            }
        }
        description += `💪 **Zaangażowanie:** ${engagementCircle}\n`;

        // Responsywność - zawsze pokazuj, jeśli null to zielona kropka
        let responsivenessCircle = '🟢'; // Domyślnie zielone (brak danych)
        if (responsivenessFactor !== null) {
            responsivenessCircle = '🔴'; // Czerwone (poniżej 25%)
            if (responsivenessFactor >= 75) {
                responsivenessCircle = '🟢'; // Zielone (75%+)
            } else if (responsivenessFactor >= 50) {
                responsivenessCircle = '🟡'; // Żółte (50-74.99%)
            } else if (responsivenessFactor >= 25) {
                responsivenessCircle = '🟠'; // Pomarańczowe (25-49.99%)
            }
        }
        description += `📨 **Responsywność:** ${responsivenessCircle}\n`;

        // Trend - tylko jeśli dostępny
        if (trendIcon !== null && trendDescription !== null) {
            description += `💨 **Trend:** ${trendDescription} ${trendIcon}\n`;
        }
        description += `\n`;

        // Sekcja 4: Progres (ostatnie 12 tygodni)
        description += `### 📈 PROGRES (OSTATNIE 12 TYGODNI)\n${resultsText}\n\n`;

        // Sekcja 5: Kary i status
        description += `### ⚖️ KARY I STATUS\n`;
        description += `📢 **Przypomnienia:** ${reminderCountTotal > 0 ? reminderCountTotal : 'brak'}\n`;
        description += `✅ **Potwierdzenia:** ${confirmationCountTotal > 0 ? confirmationCountTotal : 'brak'}\n`;
        description += `💀 **Punkty kary (lifetime):** ${lifetimePoints > 0 ? lifetimePoints : 'brak'}\n`;
        description += `🎭 **Rola karania:** ${hasPunishmentRole ? 'Tak' : 'Nie'}\n`;
        description += `🚨 **Blokada loterii:** ${hasLotteryBanRole ? 'Tak' : 'Nie'}`;

        // Stwórz embed z pełnym description
        const embed = new EmbedBuilder()
            .setDescription(description)
            .setColor('#00BFFF')
            .setTimestamp();

        // Ustaw auto-usuwanie po 5 minutach
        const deleteAt = Date.now() + (5 * 60 * 1000);
        const deleteTimestamp = Math.floor(deleteAt / 1000);

        // Footer z informacją o wygaśnięciu
        embed.setFooter({
            text: `Tygodni z danymi: ${playerProgressData.length}/12 | Najlepszy wynik: ${maxScore.toLocaleString('pl-PL')} | Wygasa: za 5 min`
        });

        const response = await interaction.editReply({ embeds: [embed] });

        // Zaplanuj usunięcie wiadomości
        const messageCleanupService = interaction.client.messageCleanupService;
        if (response && messageCleanupService) {
            await messageCleanupService.scheduleMessageDeletion(
                response.id,
                response.channelId,
                deleteAt,
                interaction.user.id
            );
        }

    } catch (error) {
        logger.error('[PLAYER-STATUS] ❌ Błąd wyświetlania statusu gracza:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania danych gracza.'
        });
    }
}

async function handleWynikiCommand(interaction, sharedState) {
    const { config } = sharedState;

    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = Object.values(config.targetRoles);
    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/wyniki` jest dostępna tylko dla członków klanu.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!allowedChannels.includes(interaction.channelId) && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: `❌ Komenda \`/wyniki\` jest dostępna tylko na określonych kanałach.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Utwórz select menu z klanami (bez parametru phase)
        const clanOptions = Object.entries(config.targetRoles).map(([clanKey, roleId]) => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(config.roleDisplayNames[clanKey])
                .setValue(clanKey);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('wyniki_select_clan')
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📊 Wyniki - Wszystkie Fazy')
            .setDescription('**Krok 1/2:** Wybierz klan, dla którego chcesz zobaczyć wyniki:')
            .setColor('#0099FF')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row],
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        logger.error('[WYNIKI] ❌ Błąd pobierania wyników:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania wyników.'
        });
    }
}

// Funkcja tworząca globalny ranking wszystkich graczy ze wszystkich klanów
async function createGlobalPlayerRanking(guild, databaseService, config, last54Weeks, members = null) {
    // Przechowuj najwyższy wynik globalny dla każdego gracza (ze wszystkich klanów)
    // ZMIANA: Używaj userId jako klucza zamiast displayName
    const playerMaxScores = new Map();

    // Iterujemy po wszystkich tygodniach i wszystkich klanach aby znaleźć najlepsze wyniki
    for (const week of last54Weeks) {
        for (const clan of week.clans) {
            const weekData = await databaseService.getPhase1Results(
                guild.id,
                week.weekNumber,
                week.year,
                clan
            );

            if (weekData && weekData.players) {
                weekData.players.forEach(player => {
                    // ZMIANA: Sprawdzaj userId zamiast tylko displayName
                    if (player.userId && player.displayName && player.score > 0) {
                        const currentData = playerMaxScores.get(player.userId);
                        const currentMaxScore = currentData ? currentData.score : 0;

                        if (player.score > currentMaxScore) {
                            // ZMIANA: Klucz to userId, przechowuj też displayName (ostatni nick z danych)
                            playerMaxScores.set(player.userId, {
                                score: player.score,
                                displayName: player.displayName
                            });
                        }
                    }
                });
            }
        }
    }

    // Pobierz wszystkich członków serwera (tylko jeśli nie przekazano)
    if (!members) {
        members = await guild.members.fetch();
    }

    // Stwórz ranking z aktywnych członków klanów
    const ranking = [];

    for (const [memberId, member] of members) {
        // Sprawdź którą rolę klanową ma member (obecny klan)
        let memberClan = null;
        let memberClanKey = null;

        for (const [clanKey, roleId] of Object.entries(config.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                memberClan = config.roleDisplayNames[clanKey];
                memberClanKey = clanKey;
                break; // Zakładamy że gracz ma tylko jedną rolę klanową
            }
        }

        // Jeśli ma rolę klanową, znajdź jego najlepszy wynik ze wszystkich klanów w historii
        if (memberClan && memberClanKey) {
            // ZMIANA: Szukaj po userId (memberId) zamiast displayName
            const scoreData = playerMaxScores.get(memberId);

            if (scoreData) {
                ranking.push({
                    userId: memberId, // Discord ID - dla wyszukiwania w rankingu
                    playerName: scoreData.displayName, // Ostatni nick z danych OCR
                    maxScore: scoreData.score,
                    clanName: memberClan, // Obecny klan
                    clanKey: memberClanKey // Obecny klan
                });
            }
        }
    }

    // Sortuj po maxScore (malejąco)
    ranking.sort((a, b) => b.maxScore - a.maxScore);

    return ranking;
}

// Funkcja wyświetlająca konkretną stronę rankingu clan-status
async function showClanStatusPage(interaction, ranking, currentPage, deleteTimestamp, viewerDisplayName, isUpdate = false) {
    const PLAYERS_PER_PAGE = 40;
    const totalPages = Math.ceil(ranking.length / PLAYERS_PER_PAGE);

    // Walidacja strony
    if (currentPage < 0) currentPage = 0;
    if (currentPage >= totalPages) currentPage = totalPages - 1;

    const startIndex = currentPage * PLAYERS_PER_PAGE;
    const endIndex = Math.min(startIndex + PLAYERS_PER_PAGE, ranking.length);
    const pageRanking = ranking.slice(startIndex, endIndex);

    // Oblicz maksymalny wynik na tej stronie dla skalowania progress bara
    const maxScoreOnPage = Math.max(...pageRanking.map(p => p.maxScore));

    // Stwórz tekst rankingu
    const barLength = 10;
    const rankingLines = pageRanking.map((player, index) => {
        const globalRank = startIndex + index + 1;
        const filledLength = player.maxScore > 0 ? Math.max(1, Math.round((player.maxScore / maxScoreOnPage) * barLength)) : 0;
        const progressBar = player.maxScore > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

        // Wyciągnij emotkę klanu z clanName (np. "🎮PolskiSquad⁰🎮" -> "🎮")
        // Użyj Array.from() aby poprawnie wyodrębnić emoji (surrogate pairs)
        const clanEmoji = Array.from(player.clanName)[0];
        const formattedScore = player.maxScore.toLocaleString('pl-PL');

        return `${globalRank}. ${progressBar} ${clanEmoji} ${player.playerName} - ${formattedScore}`;
    });

    const rankingText = rankingLines.join('\n');

    // Informacja o wygaśnięciu
    const expiryInfo = deleteTimestamp ? `\n\n⏱️ Wygasa: <t:${deleteTimestamp}:R>` : '';

    // Przyciski paginacji
    const navigationButtons = [];

    if (currentPage > 0) {
        const prevButton = new ButtonBuilder()
            .setCustomId(`clan_status_prev|${currentPage}`)
            .setLabel('◀')
            .setStyle(ButtonStyle.Secondary);
        navigationButtons.push(prevButton);
    }

    if (currentPage < totalPages - 1) {
        const nextButton = new ButtonBuilder()
            .setCustomId(`clan_status_next|${currentPage}`)
            .setLabel('▶')
            .setStyle(ButtonStyle.Secondary);
        navigationButtons.push(nextButton);
    }

    const components = [];
    if (navigationButtons.length > 0) {
        const navRow = new ActionRowBuilder().addComponents(navigationButtons);
        components.push(navRow);
    }

    const embed = new EmbedBuilder()
        .setTitle(`🏆 Globalny Ranking - Wszyscy Gracze`)
        .setDescription(`**Najlepsze wyniki z Fazy 1:**\n\n${rankingText}${expiryInfo}`)
        .setColor('#FFD700')
        .setFooter({ text: `Strona ${currentPage + 1}/${totalPages} | Graczy: ${ranking.length} | Ogląda: ${viewerDisplayName}` })
        .setTimestamp();

    if (isUpdate) {
        await interaction.update({
            embeds: [embed],
            components: components
        });
    } else {
        await interaction.editReply({
            embeds: [embed],
            components: components
        });
    }
}

// Handler dla komendy /clan-status
async function handleClanStatusCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = Object.values(config.targetRoles);
    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/clan-status` jest dostępna tylko dla członków klanu.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!allowedChannels.includes(interaction.channelId) && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: `❌ Komenda \`/clan-status\` jest dostępna tylko na określonych kanałach.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply();

    try {
        // Pobierz wszystkie dostępne tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.editReply({
                content: '❌ Brak zapisanych wyników. Użyj `/faza1` aby rozpocząć zbieranie danych.'
            });
            return;
        }

        const last54Weeks = allWeeks.slice(0, 54);

        // Stwórz globalny ranking
        const ranking = await createGlobalPlayerRanking(
            interaction.guild,
            databaseService,
            config,
            last54Weeks
        );

        if (ranking.length === 0) {
            await interaction.editReply({
                content: '❌ Brak aktywnych członków klanów z wynikami w bazie danych.'
            });
            return;
        }

        // Ustaw czas usunięcia (5 minut)
        const deleteAt = Date.now() + (5 * 60 * 1000);
        const deleteTimestamp = Math.floor(deleteAt / 1000);

        // Pobierz displayName osoby wywołującej komendę
        const viewerDisplayName = interaction.member?.displayName || interaction.user.username;

        // Wyświetl pierwszą stronę
        await showClanStatusPage(interaction, ranking, 0, deleteTimestamp, viewerDisplayName, false);

        // Zapisz ranking w cache dla paginacji (używamy message.id jako klucza)
        if (!sharedState.clanStatusPagination) {
            sharedState.clanStatusPagination = new Map();
        }

        const response = await interaction.fetchReply();
        sharedState.clanStatusPagination.set(response.id, {
            ranking: ranking,
            timestamp: Date.now()
        });

        // Zaplanuj usunięcie wiadomości po 5 minutach
        const messageCleanupService = interaction.client.messageCleanupService;
        if (response && messageCleanupService) {
            await messageCleanupService.scheduleMessageDeletion(
                response.id,
                response.channelId,
                deleteAt,
                interaction.user.id
            );
        }

        // Automatyczne czyszczenie cache po 15 minutach (dłużej niż auto-delete)
        setTimeout(() => {
            if (sharedState.clanStatusPagination) {
                sharedState.clanStatusPagination.delete(response.id);
            }
        }, 15 * 60 * 1000);

    } catch (error) {
        logger.error('[CLAN-STATUS] ❌ Błąd wyświetlania rankingu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania danych rankingu.'
        });
    }
}

// Handler dla przycisków paginacji clan-status
async function handleClanStatusPageButton(interaction, sharedState) {
    try {
        // Pobierz dane paginacji
        if (!sharedState.clanStatusPagination) {
            await interaction.reply({
                content: '❌ Sesja paginacji wygasła. Użyj `/clan-status` ponownie.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const paginationData = sharedState.clanStatusPagination.get(interaction.message.id);
        if (!paginationData) {
            await interaction.reply({
                content: '❌ Nie znaleziono danych paginacji. Sesja mogła wygasnąć.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Parsuj customId
        const [action, currentPageStr] = interaction.customId.split('|');
        const currentPage = parseInt(currentPageStr, 10);

        // Oblicz nową stronę
        let newPage = currentPage;
        if (action === 'clan_status_prev') {
            newPage = currentPage - 1;
        } else if (action === 'clan_status_next') {
            newPage = currentPage + 1;
        }

        // Resetuj timer usunięcia (5 minut od teraz)
        const deleteAt = Date.now() + (5 * 60 * 1000);
        const deleteTimestamp = Math.floor(deleteAt / 1000);

        // Pobierz displayName osoby klikającej przycisk
        const viewerDisplayName = interaction.member?.displayName || interaction.user.username;

        // Wyświetl nową stronę z nowym timestampem
        await showClanStatusPage(interaction, paginationData.ranking, newPage, deleteTimestamp, viewerDisplayName, true);

        // Zaktualizuj scheduled deletion z nowym czasem
        const messageCleanupService = interaction.client.messageCleanupService;
        if (messageCleanupService) {
            // Usuń stare zaplanowane usunięcie
            await messageCleanupService.removeScheduledMessage(interaction.message.id);

            // Dodaj nowe zaplanowane usunięcie z resetowanym timerem
            await messageCleanupService.scheduleMessageDeletion(
                interaction.message.id,
                interaction.message.channelId,
                deleteAt,
                interaction.user.id
            );
        }

        // Odśwież timestamp w cache
        paginationData.timestamp = Date.now();

    } catch (error) {
        logger.error('[CLAN-STATUS] ❌ Błąd paginacji:', error);
        await interaction.reply({
            content: '❌ Wystąpił błąd podczas zmiany strony.',
            flags: MessageFlags.Ephemeral
        });
    }
}

// Handler dla komendy /clan-progres
async function handleClanProgresCommand(interaction, sharedState) {
    const { config, databaseService } = sharedState;

    // Sprawdź czy użytkownik ma rolę klanową
    const clanRoleIds = Object.values(config.targetRoles);
    const hasClanRole = clanRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isAdmin = interaction.member.permissions.has('Administrator');

    if (!hasClanRole && !isAdmin) {
        await interaction.reply({
            content: '❌ Komenda `/clan-progres` jest dostępna tylko dla członków klanu.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Sprawdź czy kanał jest dozwolony
    const allowedChannels = [
        ...Object.values(config.warningChannels),
        '1348200849242984478'
    ];

    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!allowedChannels.includes(interaction.channelId) && !isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: `❌ Komenda \`/clan-progres\` jest dostępna tylko na określonych kanałach.`,
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    // Defer jako ephemeral - wybór klanu jest prywatny
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Utwórz select menu z klanami
        const clanOptions = Object.entries(config.targetRoles).map(([clanKey, roleId]) => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(config.roleDisplayNames[clanKey])
                .setValue(clanKey);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('clan_progres_select_clan')
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('📊 Progres Klanu - TOP30')
            .setDescription('**Wybierz klan**, dla którego chcesz zobaczyć progres TOP30:')
            .setColor('#0099FF')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

    } catch (error) {
        logger.error('[CLAN-PROGRES] ❌ Błąd wyświetlania progresu klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas pobierania danych progresu klanu.'
        });
    }
}

// Funkcja pomocnicza wyświetlająca progres TOP30 dla klanu
async function showClanProgress(interaction, selectedClan, sharedState) {
    const { config, databaseService } = sharedState;
    const clanName = config.roleDisplayNames[selectedClan];

    try {
        // Pobierz wszystkie dostępne tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.followUp({
                content: '❌ Brak zapisanych wyników. Użyj `/faza1` aby rozpocząć zbieranie danych.'
            });
            return;
        }

        // Pobierz ostatnie 54 tygodnie (wszystkie, nie tylko dla klanu)
        const last54Weeks = allWeeks
            .sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.weekNumber - a.weekNumber;
            })
            .slice(0, 54); // Max 54 tygodnie

        // Zbierz dane TOP30 dla każdego tygodnia (tylko dla wybranego klanu)
        const clanProgressData = [];

        for (const week of last54Weeks) {
            const weekData = await databaseService.getPhase1Results(
                interaction.guild.id,
                week.weekNumber,
                week.year,
                selectedClan
            );

            if (weekData && weekData.players) {
                // Oblicz sumę TOP30
                const sortedPlayers = [...weekData.players].sort((a, b) => b.score - a.score);
                const top30Players = sortedPlayers.slice(0, 30);
                const top30Sum = top30Players.reduce((sum, player) => sum + player.score, 0);

                clanProgressData.push({
                    weekNumber: week.weekNumber,
                    year: week.year,
                    top30Sum: top30Sum,
                    playerCount: weekData.players.length,
                    createdAt: weekData.createdAt
                });
            }
        }

        if (clanProgressData.length === 0) {
            await interaction.followUp({
                content: `❌ Brak wyników TOP30 dla klanu **${clanName}**.`
            });
            return;
        }

        // Oblicz progres/regres skumulowany (podobnie jak w /progres)
        const formatDifference = (difference) => {
            if (difference > 0) {
                return `▲ ${difference.toLocaleString('pl-PL')}`;
            } else if (difference < 0) {
                return `▼ ${Math.abs(difference).toLocaleString('pl-PL')}`;
            }
            return '━';
        };

        // Małe liczby dla progress barów (tydzień do tygodnia)
        const superscriptMap = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
        const subscriptMap = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉' };

        const formatSmallDifference = (difference) => {
            if (difference > 0) {
                const superscriptNumber = ('' + difference).split('').map(c => superscriptMap[c] || c).join('');
                return ` ▲${superscriptNumber}`;
            } else if (difference < 0) {
                const subscriptNumber = ('' + Math.abs(difference)).split('').map(c => subscriptMap[c] || c).join('');
                return ` ▼${subscriptNumber}`;
            }
            return '';
        };

        let cumulativeSection = '';

        // Wyświetl dostępne dane nawet jeśli jest ich mniej niż idealnie
        if (clanProgressData.length >= 2) {
            // Miesiąc (idealnie 4 tygodnie, ale pokaż co jest dostępne)
            if (clanProgressData.length >= 4) {
                const diff = clanProgressData[0].top30Sum - clanProgressData[3].top30Sum;
                cumulativeSection += `**🔹 Miesiąc (4 tyg):** ${formatDifference(diff)}\n`;
            } else if (clanProgressData.length >= 2) {
                const weeksCount = clanProgressData.length - 1;
                const diff = clanProgressData[0].top30Sum - clanProgressData[weeksCount].top30Sum;
                cumulativeSection += `**🔹 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }

            // Kwartał (idealnie 13 tygodni)
            if (clanProgressData.length >= 13) {
                const diff = clanProgressData[0].top30Sum - clanProgressData[12].top30Sum;
                cumulativeSection += `**🔷 Kwartał (13 tyg):** ${formatDifference(diff)}\n`;
            } else if (clanProgressData.length >= 8) {
                const weeksCount = Math.min(12, clanProgressData.length - 1);
                const diff = clanProgressData[0].top30Sum - clanProgressData[weeksCount].top30Sum;
                cumulativeSection += `**🔷 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }

            // Pół roku (idealnie 26 tygodni)
            if (clanProgressData.length >= 26) {
                const diff = clanProgressData[0].top30Sum - clanProgressData[25].top30Sum;
                cumulativeSection += `**🔶 Pół roku (26 tyg):** ${formatDifference(diff)}\n`;
            } else if (clanProgressData.length >= 14) {
                const weeksCount = Math.min(25, clanProgressData.length - 1);
                const diff = clanProgressData[0].top30Sum - clanProgressData[weeksCount].top30Sum;
                cumulativeSection += `**🔶 Dostępne dane (${weeksCount} tyg):** ${formatDifference(diff)}\n`;
            }
        }

        if (cumulativeSection) {
            cumulativeSection += '\n';
        }

        // Oblicz maksymalny wynik dla progress bara (do skalowania)
        const maxScore = Math.max(...clanProgressData.map(d => d.top30Sum));

        // Stwórz mapę wyników klanu dla szybkiego dostępu
        const clanScoreMap = new Map();
        clanProgressData.forEach(data => {
            const key = `${data.weekNumber}-${data.year}`;
            clanScoreMap.set(key, data.top30Sum);
        });

        // Przygotuj tekst z wynikami - iteruj po WSZYSTKICH tygodniach
        const barLength = 10;
        const resultsLines = [];

        for (let i = 0; i < last54Weeks.length; i++) {
            const week = last54Weeks[i];
            const weekKey = `${week.weekNumber}-${week.year}`;
            const score = clanScoreMap.get(weekKey);
            const weekLabel = `${String(week.weekNumber).padStart(2, '0')}/${String(week.year).slice(-2)}`;

            // Oblicz najlepszy wynik z POPRZEDNICH (wcześniejszych) tygodni
            let bestScoreUpToNow = 0;
            for (let j = i + 1; j < last54Weeks.length; j++) {
                const pastWeek = last54Weeks[j];
                const pastWeekKey = `${pastWeek.weekNumber}-${pastWeek.year}`;
                const pastScore = clanScoreMap.get(pastWeekKey);
                if (pastScore !== undefined && pastScore > bestScoreUpToNow) {
                    bestScoreUpToNow = pastScore;
                }
            }

            if (score !== undefined) {
                // Klan ma dane z tego tygodnia - pokaż normalny pasek
                const filledLength = score > 0 ? Math.max(1, Math.round((score / maxScore) * barLength)) : 0;
                const progressBar = score > 0 ? '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength) : '░'.repeat(barLength);

                // Oblicz różnicę względem najlepszego wyniku DO TEGO MOMENTU
                let differenceText = '';
                if (bestScoreUpToNow > 0 && score !== bestScoreUpToNow) {
                    const difference = score - bestScoreUpToNow;
                    differenceText = formatSmallDifference(difference);
                }

                resultsLines.push(`${progressBar} ${weekLabel} - ${score.toLocaleString('pl-PL')}${differenceText}`);
            } else {
                // Klan nie ma danych z tego tygodnia - pokaż pusty pasek bez wartości
                const progressBar = '░'.repeat(barLength);
                resultsLines.push(`${progressBar} ${weekLabel} - `);
            }
        }

        const resultsText = resultsLines.join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`📊 Progres TOP30 - ${clanName}`)
            .setDescription(
                `**Skumulowany progres/regres:**\n${cumulativeSection}` +
                `**Historia wyników TOP30 (Faza 1):**\n${resultsText}`
            )
            .setColor('#00FF00')
            .setFooter({ text: `Klan: ${clanName} | Wyświetlono ${last54Weeks.length} tygodni (${clanProgressData.length} z danymi)` })
            .setTimestamp();

        // Wyślij publiczne wyniki
        await interaction.followUp({
            embeds: [embed]
        });

        logger.info(`[CLAN-PROGRES] ✅ Wyświetlono progres klanu ${clanName}`);

    } catch (error) {
        logger.error('[CLAN-PROGRES] ❌ Błąd wyświetlania progresu klanu:', error);
        await interaction.followUp({
            content: '❌ Wystąpił błąd podczas pobierania danych progresu klanu.'
        });
    }
}

// ============ FUNKCJE POMOCNICZE DLA DECYZJI O URLOPOWICZACH ============

/**
 * Pokazuje pytanie o konkretną osobę na urlopie
 */
async function showVacationDecisionPrompt(session, type, sharedState) {
    const { vacationDecisionData } = session;
    const { playersWithVacation, currentVacationIndex, interaction } = vacationDecisionData;

    if (currentVacationIndex >= playersWithVacation.length) {
        // Wszystkie decyzje podjęte - finalizuj
        await finalizeAfterVacationDecisions(session, type, sharedState);
        return;
    }

    const currentPlayer = playersWithVacation[currentVacationIndex];
    const member = currentPlayer.user.member;
    const detectedNick = currentPlayer.detectedNick;

    const embed = new EmbedBuilder()
        .setTitle('🏖️ Gracz ma aktywny urlop')
        .setDescription(
            `**Gracz:** ${member.toString()} (${member.displayName})\n` +
            `**Wykryty nick:** ${detectedNick}\n\n` +
            `Ten gracz ma aktywny urlop (znaleziono wiadomość z reakcjami na kanale urlopów).\n\n` +
            `**Czy chcesz uwzględnić tego gracza?**\n` +
            `• **Tak** - gracz zostanie ${type === 'remind' ? 'powiadomiony' : 'ukarany'} pomimo urlopu\n` +
            `• **Nie** - gracz zostanie pominięty\n\n` +
            `**(${currentVacationIndex + 1}/${playersWithVacation.length})**`
        )
        .setColor('#FFA500')
        .setTimestamp()
        .setThumbnail(member.user.displayAvatarURL());

    const includeButton = new ButtonBuilder()
        .setCustomId(`${type}_vacation_include`)
        .setLabel('✅ Tak, uwzględnij')
        .setStyle(ButtonStyle.Success);

    const excludeButton = new ButtonBuilder()
        .setCustomId(`${type}_vacation_exclude`)
        .setLabel('❌ Nie, pomiń')
        .setStyle(ButtonStyle.Danger);

    const row = new ActionRowBuilder()
        .addComponents(includeButton, excludeButton);

    await interaction.editReply({
        content: `⏳ **Pytanie o urlopowiczów** (${currentVacationIndex + 1}/${playersWithVacation.length})`,
        embeds: [embed],
        components: [row]
    });

    logger.info(`[${type.toUpperCase()}] 🏖️ Pytanie o ${member.displayName} (${currentVacationIndex + 1}/${playersWithVacation.length})`);
}

/**
 * Finalizuje proces po podjęciu wszystkich decyzji o urlopowiczach
 */
async function finalizeAfterVacationDecisions(session, type, sharedState) {
    const { vacationDecisionData } = session;
    const { allFoundUsers, vacationDecisions, playersWithVacation, interaction } = vacationDecisionData;

    // Filtruj użytkowników na podstawie decyzji
    const finalUsers = allFoundUsers.filter(userData => {
        const userId = userData.user.member.id;

        // Jeśli użytkownik nie ma urlopu, zawsze go uwzględnij
        if (!vacationDecisions.hasOwnProperty(userId)) {
            return true;
        }

        // Jeśli ma urlop, uwzględnij tylko jeśli decyzja to true
        return vacationDecisions[userId] === true;
    });

    const includedVacationers = playersWithVacation.filter(p => vacationDecisions[p.user.member.id] === true);
    const excludedVacationers = playersWithVacation.filter(p => vacationDecisions[p.user.member.id] === false);

    logger.info(`[${type.toUpperCase()}] 🏖️ Decyzje o urlopowiczach zakończone:`);
    logger.info(`[${type.toUpperCase()}] 🏖️ Uwzględnieni (${includedVacationers.length}): ${includedVacationers.map(p => p.user.member.displayName).join(', ') || 'brak'}`);
    logger.info(`[${type.toUpperCase()}] 🏖️ Pominięci (${excludedVacationers.length}): ${excludedVacationers.map(p => p.user.member.displayName).join(', ') || 'brak'}`);
    logger.info(`[${type.toUpperCase()}] 📊 ${allFoundUsers.length} znalezionych → ${finalUsers.length} po uwzględnieniu decyzji`);

    if (finalUsers.length === 0) {
        // Zatrzymaj ghost ping
        stopGhostPing(session);

        const message = type === 'remind'
            ? '✅ Wszyscy znalezieni gracze zostali pominięci - nie wysłano żadnych przypomnień.'
            : '✅ Wszyscy znalezieni gracze zostali pominięci - nie dodano żadnych punktów karnych.';

        await interaction.editReply({
            content: message,
            embeds: [],
            components: []
        });

        // Zakończ sesję OCR i wyczyść
        await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);

        if (type === 'remind') {
            await sharedState.reminderService.cleanupSession(session.sessionId);
        } else {
            await sharedState.punishmentService.cleanupSession(session.sessionId);
        }

        return;
    }

    // Wyczyść dane decyzji urlopowych z sesji
    delete session.vacationDecisionData;

    // Kontynuuj proces z przefiltrowaną listą użytkowników
    if (type === 'remind') {
        // Pokaż progress bar z odliczaniem 5 sekund
        for (let i = 5; i >= 0; i--) {
            const progress = ((5 - i) / 5) * 100;
            const filledBars = Math.floor(progress / 10);
            const emptyBars = 10 - filledBars;
            const progressBar = '█'.repeat(filledBars) + '░'.repeat(emptyBars);

            await interaction.editReply({
                content: `⏳ **Wysyłanie powiadomień za ${i} sekund...**\n\n${progressBar} ${Math.floor(progress)}%`,
                embeds: [],
                components: []
            });

            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Wyślij przypomnienia
        await interaction.editReply({
            content: '⏳ **Wysyłanie powiadomień...**\n\nWysyłam wiadomości do użytkowników.',
            embeds: [],
            components: []
        });

        try {
            const reminderResult = await sharedState.reminderService.sendReminders(interaction.guild, finalUsers);

            // Zapisz użycie /remind przez klan (dla limitów czasowych)
            await sharedState.reminderUsageService.recordRoleUsage(session.userClanRoleId, session.userId);

            // Utwórz tracking status potwierdzeń
            const vacationMembers = finalUsers
                .filter(userData => userData.user && userData.user.member)
                .map(userData => userData.user.member);

            if (vacationMembers.length > 0) {
                try {
                    await sharedState.reminderStatusTrackingService.createOrUpdateTracking(
                        interaction.guild,
                        session.userClanRoleId,
                        vacationMembers,
                        sharedState.reminderUsageService
                    );
                    logger.info(`[REMIND] 📊 Utworzono tracking statusów dla ${vacationMembers.length} użytkowników`);
                } catch (trackingError) {
                    logger.error(`[REMIND] ❌ Błąd tworzenia trackingu statusów: ${trackingError.message}`);
                }
            }

            // Przekształć finalUsers do formatu oczekiwanego przez recordPingedUsers
            const pingData = finalUsers
                .filter(userData => userData.user && userData.user.member)
                .map(userData => ({
                    member: userData.user.member,
                    matchedName: userData.detectedNick
                }));

            // Zapisz pingi do użytkowników (dla statystyk w /debug-roles)
            if (pingData.length > 0) {
                await sharedState.reminderUsageService.recordPingedUsers(pingData);
            } else {
                logger.warn(`[REMIND] ⚠️ Brak użytkowników z member do zapisania w statystykach`);
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle('✅ Przypomnienia wysłane')
                .setDescription(
                    `Pomyślnie wysłano **${reminderResult.sentMessages}** ${reminderResult.sentMessages === 1 ? 'przypomnienie' : 'przypomnień'} ` +
                    `dla **${reminderResult.totalUsers}** ${reminderResult.totalUsers === 1 ? 'użytkownika' : 'użytkowników'}.`
                )
                .setColor('#00FF00')
                .setTimestamp()
                .setFooter({ text: `Wysłano do ${reminderResult.roleGroups} ${reminderResult.roleGroups === 1 ? 'grupy' : 'grup'} ról` });

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            // Sprawdź czy interakcja nie wygasła przed próbą edycji
            try {
                await interaction.editReply({
                    content: null,
                    embeds: [summaryEmbed],
                    components: []
                });
            } catch (editError) {
                if (editError.code === 10008) {
                    logger.warn('[REMIND] ⚠️ Interakcja wygasła, nie można zaktualizować wiadomości');
                } else {
                    logger.error(`[REMIND] ⚠️ Błąd aktualizacji wiadomości: ${editError.message}`);
                }
            }

            // Zakończ sesję OCR i wyczyść
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.reminderService.cleanupSession(session.sessionId);

            logger.info(`[REMIND] ✅ Zakończono wysyłanie przypomnień dla ${finalUsers.length} użytkowników`);
        } catch (error) {
            stopGhostPing(session);

            logger.error('[REMIND] ❌ Błąd wysyłania przypomnień:', error);

            await interaction.editReply({
                content: `❌ Wystąpił błąd podczas wysyłania przypomnień: ${error.message}`,
                embeds: [],
                components: []
            });

            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.reminderService.cleanupSession(session.sessionId);
        }

    } else {
        // Dodaj punkty karne
        await interaction.editReply({
            content: '⏳ **Dodawanie punktów karnych...**\n\nDodaję punkty użytkownikom.',
            embeds: [],
            components: []
        });

        try {
            const punishmentResults = await sharedState.punishmentService.processPunishments(interaction.guild, finalUsers);

            let summaryText = `Pomyślnie dodano punkty karne dla **${punishmentResults.length}** ${punishmentResults.length === 1 ? 'użytkownika' : 'użytkowników'}.\n\n`;
            summaryText += `**📊 Lista ukaranych graczy:**\n`;

            for (const result of punishmentResults) {
                summaryText += `• ${result.user.displayName} → **${result.points}** ${result.points === 1 ? 'punkt' : result.points < 5 ? 'punkty' : 'punktów'}\n`;
            }

            const summaryEmbed = new EmbedBuilder()
                .setTitle('✅ Punkty karne dodane')
                .setDescription(summaryText)
                .setColor('#00FF00')
                .setTimestamp()
                .setFooter({ text: 'System automatycznego karania' });

            // Zatrzymaj ghost ping
            stopGhostPing(session);

            await interaction.editReply({
                content: null,
                embeds: [summaryEmbed],
                components: []
            });

            // Zakończ sesję OCR i wyczyść
            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.punishmentService.cleanupSession(session.sessionId);

            logger.info(`[PUNISH] ✅ Zakończono dodawanie punktów karnych dla ${finalUsers.length} użytkowników`);
        } catch (error) {
            stopGhostPing(session);

            logger.error('[PUNISH] ❌ Błąd dodawania punktów karnych:', error);

            await interaction.editReply({
                content: `❌ Wystąpił błąd podczas dodawania punktów karnych: ${error.message}`,
                embeds: [],
                components: []
            });

            await sharedState.ocrService.endOCRSession(interaction.guild.id, interaction.user.id, true);
            await sharedState.punishmentService.cleanupSession(session.sessionId);
        }
    }
}

// Helper: Wczytaj potwierdzenia z JSON
async function loadConfirmations(config) {
    try {
        const data = await fs.readFile(config.database.reminderConfirmations, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        // Jeśli plik nie istnieje lub jest pusty, zwróć pustą strukturę
        return { sessions: {}, userStats: {} };
    }
}

// Helper: Zapisz potwierdzenia do JSON
async function saveConfirmations(config, data) {
    await fs.writeFile(config.database.reminderConfirmations, JSON.stringify(data, null, 2), 'utf8');
}

// Helper: Utwórz klucz sesji (zaokrąglony do 30 minut, żeby grupować potwierdzenia z tego samego przypomnienia)
function createSessionKey(roleId, timestamp = Date.now()) {
    const roundedTime = Math.floor(timestamp / (30 * 60 * 1000)) * (30 * 60 * 1000);
    return `${roleId}_${roundedTime}`;
}

// Handler dla przycisku "Potwierdź odbiór" z przypomnienia o bossie
async function handleConfirmReminderButton(interaction, sharedState) {
    const { config } = sharedState;

    try {
        // Parsuj customId - obsługa dwóch formatów:
        // - NOWY: confirm_reminder_{userId}_{roleId}_{guildId}
        // - STARY: confirm_reminder_{userId}_{roleId} (bez guildId - backward compatibility)
        const parts = interaction.customId.split('_');
        const userId = parts[2];
        const roleId = parts[3];
        const guildId = parts[4]; // Może być undefined dla starych przycisków

        logger.info(`[CONFIRM_REMINDER] 📝 Parsowanie customId: userId=${userId}, roleId=${roleId}, guildId=${guildId || 'BRAK (stary format)'}`);

        // Pobierz guild
        let guild = interaction.guild; // W kanale guild jest dostępny

        // Jeśli guild jest null (DM) lub nie ma guildId w customId (stary przycisk)
        if (!guild) {
            if (guildId) {
                // NOWY FORMAT - mamy guildId w customId
                logger.info(`[CONFIRM_REMINDER] 🔍 Pobieranie guild z client (DM, nowy format)`);
                guild = await interaction.client.guilds.fetch(guildId);
            } else {
                // STARY FORMAT - nie ma guildId, musimy znaleźć guild przez roleId
                logger.info(`[CONFIRM_REMINDER] 🔍 Pobieranie guild z client (DM, stary format - szukanie przez roleId)`);

                // Przeszukaj wszystkie guildy bota i znajdź ten który ma daną rolę
                for (const [id, cachedGuild] of interaction.client.guilds.cache) {
                    try {
                        const role = await cachedGuild.roles.fetch(roleId);
                        if (role) {
                            guild = cachedGuild;
                            logger.info(`[CONFIRM_REMINDER] ✅ Znaleziono guild: ${guild.name} (${guild.id})`);
                            break;
                        }
                    } catch (error) {
                        // Rola nie istnieje w tym guildzie, próbuj dalej
                        continue;
                    }
                }
            }
        }

        if (!guild) {
            logger.error(`[CONFIRM_REMINDER] ❌ Nie znaleziono serwera (guildId: ${guildId || 'BRAK'})`);
            await interaction.reply({
                content: '❌ Błąd - nie znaleziono serwera.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        logger.info(`[CONFIRM_REMINDER] 🏰 Używam guild: ${guild.name} (${guild.id})`);

        // Sprawdź czy użytkownik potwierdza przed deadline
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: config.timezone }));

        const deadline = new Date(polandTime);
        deadline.setHours(config.bossDeadline.hour, config.bossDeadline.minute, 0, 0);

        // Jeśli już po deadline dzisiaj
        if (polandTime >= deadline) {
            // Zaktualizuj wiadomość - usuń przycisk i dodaj informację o wygaśnięciu
            try {
                await interaction.update({
                    content: interaction.message.content + '\n\n⏰ **Czas na potwierdzenie minął!**',
                    components: []
                });
            } catch (updateError) {
                // Jeśli nie można zaktualizować wiadomości, wyślij odpowiedź ephemeral
                await interaction.reply({
                    content: `⏰ **Za późno by potwierdzić odbiór!**\n\nPotwierdzenia można wysyłać tylko do godziny **${config.bossDeadline.hour}:${String(config.bossDeadline.minute).padStart(2, '0')}**.\n\nDeadline już minął - potwierdzenie nie zostało zapisane.`,
                    flags: MessageFlags.Ephemeral
                });
            }
            logger.info(`⏰ ${interaction.user.tag} próbował potwierdzić po deadline (${polandTime.toLocaleTimeString('pl-PL')})`);
            return;
        }

        // Wczytaj dane potwierdzeń
        const confirmations = await loadConfirmations(config);

        // Utwórz klucz sesji (aktualny czas)
        const currentSessionKey = createSessionKey(roleId);

        // Znajdź aktywną sesję dla tej roli (w ostatnich 24h)
        let sessionKey = currentSessionKey;
        let foundExistingSession = false;

        // Jeśli sesja dla aktualnego okna nie istnieje, szukaj w ostatnich 24h
        if (!confirmations.sessions[currentSessionKey]) {
            const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
            let latestSessionTime = 0;
            let latestSessionKey = null;

            // Przeszukaj wszystkie sesje
            for (const [key, session] of Object.entries(confirmations.sessions)) {
                // Sprawdź czy sesja jest dla tej roli
                if (key.startsWith(roleId + '_')) {
                    // Wyciągnij timestamp z klucza sesji
                    const sessionTime = parseInt(key.split('_')[1]);

                    // Sprawdź czy sesja jest w ostatnich 24h i jest nowsza niż poprzednie
                    if (sessionTime >= oneDayAgo && sessionTime > latestSessionTime) {
                        latestSessionTime = sessionTime;
                        latestSessionKey = key;
                    }
                }
            }

            // Jeśli znaleziono sesję w ostatnich 24h, użyj jej
            if (latestSessionKey) {
                sessionKey = latestSessionKey;
                foundExistingSession = true;
                logger.info(`[CONFIRM_REMINDER] 🔍 Znaleziono istniejącą sesję: ${sessionKey} (zamiast ${currentSessionKey})`);
            }
        } else {
            foundExistingSession = true;
        }

        // Sprawdź czy użytkownik już potwierdził w tej sesji
        if (confirmations.sessions[sessionKey]?.confirmedUsers?.includes(userId)) {
            // Zaktualizuj wiadomość - usuń przycisk jeśli jeszcze istnieje
            try {
                await interaction.update({
                    content: interaction.message.content + '\n\n✅ **Odbiór już został potwierdzony!**',
                    components: []
                });
            } catch (updateError) {
                // Jeśli nie można zaktualizować wiadomości, wyślij odpowiedź ephemeral
                await interaction.reply({
                    content: '✅ Już potwierdziłeś odbiór tego przypomnienia!',
                    flags: MessageFlags.Ephemeral
                });
            }
            logger.info(`⚠️ ${interaction.user.tag} próbował potwierdzić ponownie (już potwierdził)`);
            return;
        }

        // Znajdź kanał potwierdzenia dla danej roli
        const confirmationChannelId = config.confirmationChannels[roleId];

        if (!confirmationChannelId) {
            logger.error(`❌ Brak kanału potwierdzenia dla roli: ${roleId}`);
            await interaction.reply({
                content: '❌ Błąd konfiguracji - brak kanału potwierdzenia.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Pobierz kanał potwierdzenia
        const confirmationChannel = await interaction.client.channels.fetch(confirmationChannelId);

        if (!confirmationChannel) {
            logger.error(`❌ Nie znaleziono kanału potwierdzenia: ${confirmationChannelId}`);
            await interaction.reply({
                content: '❌ Błąd - nie znaleziono kanału potwierdzenia.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // Znajdź nazwę klanu na podstawie roleId
        let clanName = 'nieznany';
        for (const [key, id] of Object.entries(config.targetRoles)) {
            if (id === roleId) {
                clanName = config.roleDisplayNames[key] || key;
                break;
            }
        }

        // Zapisz potwierdzenie do JSON
        const times = new Date().toISOString();

        // Utwórz sesję jeśli nie istnieje
        if (!confirmations.sessions[sessionKey]) {
            confirmations.sessions[sessionKey] = {
                createdAt: times,
                confirmedUsers: []
            };
        }

        // Dodaj userId do potwierdzeń w tej sesji
        confirmations.sessions[sessionKey].confirmedUsers.push(userId);

        // Pobierz aktualny nick użytkownika z serwera (guild został już pobrany wcześniej)
        const member = await guild.members.fetch(userId);
        const currentDisplayName = member ? member.displayName : interaction.user.username;

        // Zaktualizuj statystyki użytkownika
        if (!confirmations.userStats[userId]) {
            confirmations.userStats[userId] = {
                totalConfirmations: 0,
                lastConfirmedAt: null,
                displayName: currentDisplayName
            };
            logger.info(`[CONFIRM_REMINDER] 📝 Utworzono nowe statystyki dla ${currentDisplayName} (${userId})`);
        } else {
            // Sprawdź czy nick się zmienił
            const oldDisplayName = confirmations.userStats[userId].displayName;
            if (oldDisplayName && oldDisplayName !== currentDisplayName) {
                logger.info(`[CONFIRM_REMINDER] 🔄 Zmiana nicku: ${oldDisplayName} → ${currentDisplayName} (${userId})`);
            }
            // Zaktualizuj nick (nawet jeśli się nie zmienił)
            confirmations.userStats[userId].displayName = currentDisplayName;
        }

        confirmations.userStats[userId].totalConfirmations += 1;
        confirmations.userStats[userId].lastConfirmedAt = times;

        // Zapisz do pliku
        await saveConfirmations(config, confirmations);

        // Usuń użytkownika z aktywnych sesji DM (przestań monitorować jego wiadomości)
        if (sharedState.reminderService) {
            await sharedState.reminderService.removeActiveReminderDM(userId);
            logger.info(`[CONFIRM_REMINDER] 🔕 Przestano monitorować wiadomości DM od użytkownika ${userId}`);
        }

        // Zaktualizuj status w trackingu potwierdzeń (z timestampem)
        const confirmationTimestamp = Date.now();
        if (sharedState.reminderStatusTrackingService) {
            try {
                await sharedState.reminderStatusTrackingService.updateUserStatus(userId, roleId, confirmationTimestamp);
                logger.info(`[CONFIRM_REMINDER] 📊 Zaktualizowano status trackingu dla użytkownika ${userId}`);
            } catch (trackingError) {
                logger.error(`[CONFIRM_REMINDER] ❌ Błąd aktualizacji trackingu: ${trackingError.message}`);
            }
        }

        // Zaktualizuj wiadomość DM - usuń przycisk i pokaż potwierdzenie
        await interaction.update({
            content: interaction.message.content + '\n\n✅ **Odbiór potwierdzony!**',
            components: []
        });

        logger.info(`✅ ${interaction.user.tag} potwierdził odbiór przypomnienia (klan: ${clanName}, łącznie: ${confirmations.userStats[userId].totalConfirmations})`);

    } catch (error) {
        logger.error('[CONFIRM_REMINDER] ❌ Błąd obsługi potwierdzenia:', error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({
                    content: '❌ Wystąpił błąd podczas potwierdzania odbioru.',
                    flags: MessageFlags.Ephemeral
                });
            } else {
                await interaction.reply({
                    content: '❌ Wystąpił błąd podczas potwierdzania odbioru.',
                    flags: MessageFlags.Ephemeral
                });
            }
        } catch (replyError) {
            logger.error('[CONFIRM_REMINDER] ❌ Nie udało się wysłać odpowiedzi:', replyError);
        }
    }
}

// Funkcja obsługująca komendę /player-raport
async function handlePlayerRaportCommand(interaction, sharedState) {
    const { config } = sharedState;

    // Sprawdź uprawnienia - tylko admin i moderatorzy
    const isAdmin = interaction.member.permissions.has('Administrator');
    const hasPunishRole = hasPermission(interaction.member, config.allowedPunishRoles);

    if (!isAdmin && !hasPunishRole) {
        await interaction.reply({
            content: '❌ Komenda `/player-raport` jest dostępna tylko dla administratorów i moderatorów.',
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
        // Utwórz select menu z klanami
        const clanOptions = Object.entries(config.targetRoles).map(([clanKey, roleId]) => {
            return new StringSelectMenuOptionBuilder()
                .setLabel(config.roleDisplayNames[clanKey])
                .setValue(clanKey);
        });

        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('player_raport_select_clan')
            .setPlaceholder('Wybierz klan')
            .addOptions(clanOptions);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        const embed = new EmbedBuilder()
            .setTitle('🔍 Raport Problematycznych Graczy')
            .setDescription('**Wybierz klan**, dla którego chcesz wygenerować raport graczy wymagających uwagi:')
            .setColor('#FF6B6B')
            .setTimestamp();

        await interaction.editReply({
            embeds: [embed],
            components: [row]
        });

    } catch (error) {
        logger.error('[PLAYER-RAPORT] ❌ Błąd wyświetlania menu klanu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas wyświetlania menu.'
        });
    }
}

// Funkcja obsługująca wybór klanu w /player-raport
async function handlePlayerRaportSelectClan(interaction, sharedState) {
    const { config, databaseService, reminderUsageService } = sharedState;
    const selectedClan = interaction.values[0];
    const clanName = config.roleDisplayNames[selectedClan];
    const clanRoleId = config.targetRoles[selectedClan];

    await interaction.update({
        content: '⏳ Analizuję graczy...',
        embeds: [],
        components: []
    });

    try {
        // Pobierz członków serwera z throttlingiem (zapobiega rate limitom Gateway opcode 8)
        await safeFetchMembers(interaction.guild);
        
        // Teraz filtruj z cache (który jest już zaktualizowany przez safeFetchMembers)
        const clanMembers = interaction.guild.members.cache.filter(member => member.roles.cache.has(clanRoleId));

        if (clanMembers.size === 0) {
            await interaction.editReply({
                content: `❌ Nie znaleziono członków w klanie **${clanName}**.`,
                embeds: [],
                components: []
            });
            return;
        }

        // Pobierz wszystkie dostępne tygodnie
        const allWeeks = await databaseService.getAvailableWeeks(interaction.guild.id);

        if (allWeeks.length === 0) {
            await interaction.editReply({
                content: '❌ Brak zapisanych wyników. Użyj `/faza1` aby rozpocząć zbieranie danych.',
                embeds: [],
                components: []
            });
            return;
        }

        // Pobierz dane o karach i przypomnieniach
        const guildPunishments = await databaseService.getGuildPunishments(interaction.guild.id);
        await reminderUsageService.loadUsageData();
        const reminderData = reminderUsageService.usageData;
        const confirmations = await loadConfirmations(config);

        // Analizuj każdego gracza
        const problematicPlayers = [];

        for (const [memberId, member] of clanMembers) {
            const analysis = await analyzePlayerForRaport(
                memberId,
                member,
                selectedClan,
                allWeeks,
                databaseService,
                guildPunishments,
                reminderData,
                confirmations,
                config
            );

            if (analysis.hasProblems) {
                problematicPlayers.push(analysis);
            }
        }

        // Sortuj według liczby problemów (malejąco)
        problematicPlayers.sort((a, b) => b.problemCount - a.problemCount);

        // Stwórz embed z wynikami
        const embed = new EmbedBuilder()
            .setTitle(`🔍 Raport Problematycznych Graczy - ${clanName}`)
            .setColor('#FF6B6B')
            .setTimestamp()
            .setFooter({ text: `Analizowano ${clanMembers.size} graczy | Znaleziono ${problematicPlayers.length} wymagających uwagi` });

        if (problematicPlayers.length === 0) {
            embed.setDescription(`✅ Wszyscy gracze w klanie **${clanName}** są w dobrej formie!\n\nBrak graczy wymagających szczególnej uwagi.`);
        } else {
            embed.setDescription(`Znaleziono **${problematicPlayers.length}** graczy wymagających uwagi:`);

            // Dodaj każdego gracza jako osobne pole (max 25 pól w embedzie)
            const maxFields = Math.min(25, problematicPlayers.length);
            for (let i = 0; i < maxFields; i++) {
                const player = problematicPlayers[i];
                embed.addFields({
                    name: `${i + 1}. ${player.displayName}`,
                    value: player.problemsText,
                    inline: false
                });
            }

            if (problematicPlayers.length > 25) {
                embed.addFields({
                    name: '⚠️ Uwaga',
                    value: `Raport zawiera tylko 25 pierwszych graczy. Łącznie znaleziono ${problematicPlayers.length} graczy wymagających uwagi.`,
                    inline: false
                });
            }
        }

        await interaction.editReply({
            content: null,
            embeds: [embed],
            components: []
        });

    } catch (error) {
        logger.error('[PLAYER-RAPORT] ❌ Błąd generowania raportu:', error);
        await interaction.editReply({
            content: '❌ Wystąpił błąd podczas generowania raportu.',
            embeds: [],
            components: []
        });
    }
}

// Funkcja pomocnicza analizująca pojedynczego gracza
async function analyzePlayerForRaport(userId, member, clanKey, allWeeks, databaseService, guildPunishments, reminderData, confirmations, config) {
    const displayName = member.displayName;
    const problems = [];

    // Pobierz dane gracza ze wszystkich tygodni
    const last12Weeks = allWeeks.slice(0, 12);
    const playerProgressData = [];

    for (const week of last12Weeks) {
        for (const clan of week.clans) {
            const weekData = await databaseService.getPhase1Results(
                member.guild.id,
                week.weekNumber,
                week.year,
                clan
            );

            if (weekData && weekData.players) {
                const player = weekData.players.find(p => p.userId === userId);

                if (player) {
                    playerProgressData.push({
                        weekNumber: week.weekNumber,
                        year: week.year,
                        score: player.score,
                        displayName: player.displayName,
                        createdAt: weekData.createdAt
                    });
                    break;
                }
            }
        }
    }

    // Jeśli brak danych, pomiń gracza
    if (playerProgressData.length === 0) {
        return { hasProblems: false };
    }

    // Sortuj od najnowszych do najstarszych
    playerProgressData.sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.weekNumber - a.weekNumber;
    });

    // === 1. Oblicz współczynniki ===

    // Pobierz dane o karach
    const userPunishment = guildPunishments[userId];
    const lifetimePoints = userPunishment ? (userPunishment.lifetime_points || 0) : 0;

    // Oblicz tygodnie z danymi (dla progów czasowych)
    const weeksSince45_2025 = playerProgressData.filter(data => {
        return data.year > 2025 || (data.year === 2025 && data.weekNumber >= 45);
    }).length;

    const weeksSince49_2025 = playerProgressData.filter(data => {
        return data.year > 2025 || (data.year === 2025 && data.weekNumber >= 49);
    }).length;

    // Oblicz liczby przypomnień i potwierdzeń (z progami czasowymi)
    let reminderCountForReliability = 0;
    let reminderCountForResponsiveness = 0;
    let confirmationCountForResponsiveness = 0;

    // Helper do obliczania różnicy tygodni
    const getWeeksDifference = (weekNum1, year1, weekNum2, year2) => {
        if (year1 === year2) {
            return weekNum1 - weekNum2;
        } else {
            return (year1 - year2) * 52 + (weekNum1 - weekNum2);
        }
    };

    if (playerProgressData.length > 0) {
        const getWeekStartDate = (weekNumber, year) => {
            const date = new Date(year, 0, 1);
            const dayOfWeek = date.getDay();
            const diff = (weekNumber - 1) * 7 - (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
            date.setDate(date.getDate() + diff);
            return date;
        };

        const oldestWeek = playerProgressData[playerProgressData.length - 1];
        const newestWeek = playerProgressData[0];

        const weeksSinceThreshold45 = getWeeksDifference(newestWeek.weekNumber, newestWeek.year, 45, 2025);
        const weeksSinceThreshold49 = getWeeksDifference(newestWeek.weekNumber, newestWeek.year, 49, 2025);

        const useThreshold45 = weeksSinceThreshold45 < 12 && (oldestWeek.year < 2025 || (oldestWeek.year === 2025 && oldestWeek.weekNumber < 45));
        const useThreshold49 = weeksSinceThreshold49 < 12 && (oldestWeek.year < 2025 || (oldestWeek.year === 2025 && oldestWeek.weekNumber < 49));

        const startDate = getWeekStartDate(oldestWeek.weekNumber, oldestWeek.year);
        const startDate45 = useThreshold45 ? getWeekStartDate(45, 2025) : startDate;
        const startDate49 = useThreshold49 ? getWeekStartDate(49, 2025) : startDate;

        const formatDate = (date) => {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const startDate45Str = formatDate(startDate45);
        const startDate49Str = formatDate(startDate49);

        // Zlicz pingi
        if (reminderData.receivers && reminderData.receivers[userId]) {
            const userPings = reminderData.receivers[userId].dailyPings || {};

            for (const dateStr in userPings) {
                if (dateStr >= startDate45Str) {
                    reminderCountForReliability += userPings[dateStr].length;
                }
                if (dateStr >= startDate49Str) {
                    reminderCountForResponsiveness += userPings[dateStr].length;
                }
            }
        }

        // Zlicz potwierdzenia
        const startTimestamp49 = startDate49.getTime();

        for (const sessionKey in confirmations.sessions) {
            const session = confirmations.sessions[sessionKey];
            const sessionDate = new Date(session.createdAt);
            const sessionTimestamp = sessionDate.getTime();

            if (session.confirmedUsers && session.confirmedUsers.includes(userId)) {
                if (sessionTimestamp >= startTimestamp49) {
                    confirmationCountForResponsiveness++;
                }
            }
        }
    }

    // Oblicz współczynniki
    let wyjebanieFactor = null;
    let timingFactor = null;

    if (weeksSince45_2025 > 0) {
        const penaltyScore = (reminderCountForReliability * 0.025) + (lifetimePoints * 0.2);
        const rawFactor = (penaltyScore / weeksSince45_2025) * 100;
        wyjebanieFactor = Math.max(0, 100 - rawFactor);

        const timingPenaltyScore = reminderCountForReliability * 0.125;
        const rawTimingFactor = (timingPenaltyScore / weeksSince45_2025) * 100;
        timingFactor = Math.max(0, 100 - rawTimingFactor);
    }

    let responsivenessFactor = null;

    if (weeksSince49_2025 > 0) {
        if (reminderCountForResponsiveness > 0) {
            responsivenessFactor = (confirmationCountForResponsiveness / reminderCountForResponsiveness) * 100;
            responsivenessFactor = Math.min(100, responsivenessFactor);
        } else if (reminderCountForResponsiveness === 0 && confirmationCountForResponsiveness === 0) {
            responsivenessFactor = 100;
        } else {
            responsivenessFactor = 0;
        }
    }

    // Oblicz współczynnik Zaangażowanie (procent tygodni z progresem dodatnim)
    let engagementFactor = null;

    if (playerProgressData.length >= 2) {
        let weeksWithProgress = 0;

        for (let i = 0; i < playerProgressData.length - 1; i++) {
            const currentWeek = playerProgressData[i];
            const previousWeek = playerProgressData[i + 1];

            const difference = currentWeek.score - previousWeek.score;
            if (difference > 0) {
                weeksWithProgress++;
            }
        }

        const totalWeekPairs = playerProgressData.length - 1;
        engagementFactor = (weeksWithProgress / totalWeekPairs) * 100;
    }

    // === 2. Sprawdź czerwone kropki ===

    if (wyjebanieFactor !== null && wyjebanieFactor < 90) {
        problems.push(`🔴 Rzetelność: ${wyjebanieFactor.toFixed(1)}%`);
    }

    if (timingFactor !== null && timingFactor < 70) {
        problems.push(`🔴 Punktualność: ${timingFactor.toFixed(1)}%`);
    }

    if (engagementFactor !== null && engagementFactor < 70) {
        problems.push(`🔴 Zaangażowanie: ${engagementFactor.toFixed(1)}%`);
    }

    if (responsivenessFactor !== null && responsivenessFactor < 25) {
        problems.push(`🔴 Responsywność: ${responsivenessFactor.toFixed(1)}%`);
    }

    // === 3. Oblicz progres miesięczny i kwartalny ===

    let monthlyProgress = null;

    // Progres miesięczny - TYLKO jeśli mamy co najmniej 5 tygodni (4 ostatnie + 1 porównawczy)
    if (playerProgressData.length >= 5) {
        // Najwyższy z ostatnich 4 tygodni vs tydzień 5
        const last4Weeks = playerProgressData.slice(0, 4);
        const currentScore = Math.max(...last4Weeks.map(d => d.score));
        const comparisonScore = playerProgressData[4].score;

        if (comparisonScore > 0) {
            monthlyProgress = currentScore - comparisonScore;
        }
    }

    let quarterlyProgress = null;

    // Progres kwartalny - TYLKO jeśli mamy pełny kwartał (13 tygodni)
    const allWeeksForQuarterly = allWeeks.slice(0, 13);
    if (allWeeksForQuarterly.length === 13) {
        // Znajdź wynik z tygodnia 13
        let week13Score = null;
        const week13 = allWeeksForQuarterly[12];

        for (const clan of week13.clans) {
            const weekData = await databaseService.getPhase1Results(
                member.guild.id,
                week13.weekNumber,
                week13.year,
                clan
            );

            if (weekData && weekData.players) {
                const player = weekData.players.find(p => p.userId === userId);
                if (player) {
                    week13Score = player.score;
                    break;
                }
            }
        }

        if (week13Score > 0 && playerProgressData.length > 0) {
            // Weź najwyższy wynik z ostatnich 12 tygodni
            const last12Weeks = playerProgressData.slice(0, Math.min(12, playerProgressData.length));
            const currentScore = Math.max(...last12Weeks.map(d => d.score));
            quarterlyProgress = currentScore - week13Score;
        }
    }

    // Sprawdź progi
    if (monthlyProgress !== null && monthlyProgress < 25) {
        problems.push(`⚠️ Progres miesięczny: ${monthlyProgress} (< 25)`);
    }

    if (quarterlyProgress !== null && quarterlyProgress < 100) {
        problems.push(`⚠️ Progres kwartalny: ${quarterlyProgress} (< 100)`);
    }

    // === 4. Oblicz trend ===

    let trendRatio = null;

    // Trend wymagany jest tylko gdy mamy zarówno progres miesięczny jak i kwartalny
    if (monthlyProgress !== null && quarterlyProgress !== null) {
        // Mając oba progresy, mamy na pewno >= 13 tygodni
        const monthlyValue = monthlyProgress;
        const longerTermValue = quarterlyProgress / 3;

        if (longerTermValue !== 0) {
            trendRatio = monthlyValue / longerTermValue;
        }
    }

    if (trendRatio !== null && trendRatio <= 0.5) {
        problems.push(`🪦 Trend: Gwałtownie malejący (${trendRatio.toFixed(2)})`);
    }

    // Zwróć wynik
    return {
        hasProblems: problems.length > 0,
        problemCount: problems.length,
        displayName: displayName,
        problemsText: problems.join('\n')
    };
}

module.exports = {
    handleInteraction,
    registerSlashCommands,
    unregisterCommand,
    confirmationData,
    sendGhostPing,
    stopGhostPing
};