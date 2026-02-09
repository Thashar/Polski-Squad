const { Client, GatewayIntentBits, Partials, Events, SlashCommandBuilder } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads, reminderStorage } = require('./services/threadService');
const { createBotLogger } = require('../utils/consoleLogger');
const AIChatService = require('./services/aiChatService');

const logger = createBotLogger('Szkolenia');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Reaction, Partials.User],
});

let lastReminderMap = new Map();

// Inicjalizuj AI Chat Service
const aiChatService = new AIChatService(config);

// Mapa feedbacku AI - przechowuje kontekst odpowiedzi do oceny (messageId -> relevantKnowledge)
const feedbackMap = new Map();

const sharedState = {
    lastReminderMap,
    client,
    config,
    aiChatService,
    feedbackMap
};

client.once(Events.ClientReady, async () => {
    logger.info(`Bot zalogowany jako ${client.user.tag}`);
    logger.info(`Aktywny na ${client.guilds.cache.size} serwerach`);
    
    client.guilds.cache.forEach(guild => {
        logger.info(`- ${guild.name} (${guild.id})`);
    });
    
    // Załaduj dane przypomień z pliku
    try {
        lastReminderMap = await reminderStorage.loadReminders();
        sharedState.lastReminderMap = lastReminderMap;
    } catch (error) {
        logger.error('❌ Błąd ładowania danych przypomień:', error.message);
    }
    
    // Rejestracja slash commands
    try {
        await client.application.commands.set([
            new SlashCommandBuilder()
                .setName('scan-knowledge')
                .setDescription('Skanuje kanały wiedzy rok wstecz i zapisuje wpisy do bazy (admin)')
        ]);
        logger.info('Zarejestrowano slash commands');
    } catch (error) {
        logger.error(`Błąd rejestracji slash commands: ${error.message}`);
    }

    logger.success('✅ Szkolenia gotowy - wątki szkoleniowe, automatyczne przypomnienia');
    await checkThreads(client, sharedState, config, true);

    // Uruchom automatyczne sprawdzanie wątków - codziennie o 18:00
    const cronExpression = `${config.timing.checkMinute} ${config.timing.checkHour} * * *`;
    cron.schedule(cronExpression, () => {
        logger.info(`🕐 Rozpoczynam zaplanowane sprawdzanie wątków (${config.timing.checkHour}:${config.timing.checkMinute.toString().padStart(2, '0')})`);
        checkThreads(client, sharedState, config);
    }, {
        timezone: "Europe/Warsaw"
    });

    logger.info(`📅 Zaplanowano sprawdzanie wątków: codziennie o ${config.timing.checkHour}:${config.timing.checkMinute.toString().padStart(2, '0')} (strefa: Europe/Warsaw)`);

});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await handleInteraction(interaction, sharedState, config);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.', 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
                await interaction.editReply({ 
                    content: '❌ Wystąpił błąd podczas przetwarzania komendy.' 
                });
            }
        } catch (replyError) {
            logger.error('❌ Nie można odpowiedzieć na interakcję (prawdopodobnie timeout):', replyError.message);
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    await handleReactionAdd(reaction, user, sharedState, config);
});

client.on(Events.MessageCreate, async (message) => {
    try {
        // === AUTO-ZBIERANIE WIEDZY (WSZYSTKO z kanałów) ===
        const channelId = message.channel.id;
        if (
            !message.author.bot &&
            AIChatService.KNOWLEDGE_CHANNEL_IDS.includes(channelId) &&
            message.content?.trim()
        ) {
            const authorName = message.member?.displayName || message.author.username;

            // Odpowiedź → zapisz jako parę Pytanie/Odpowiedź
            if (message.reference) {
                try {
                    const repliedMessage = await message.fetchReference();
                    if (repliedMessage.content?.trim()) {
                        await aiChatService.saveKnowledgeEntry(
                            `Pytanie: ${repliedMessage.content} Odpowiedź: ${message.content}`,
                            authorName,
                            channelId
                        );
                    } else {
                        await aiChatService.saveKnowledgeEntry(message.content, authorName, channelId);
                    }
                } catch (err) {
                    await aiChatService.saveKnowledgeEntry(message.content, authorName, channelId);
                }
            } else {
                // Zwykła wiadomość → zapisz bezpośrednio
                await aiChatService.saveKnowledgeEntry(message.content, authorName, channelId);
            }
        }

        // === AI CHAT HANDLER ===
        // Sprawdź czy bot jest oznaczony (ale nie przez @everyone/@here i nie przez odpowiedzi)
        const isBotMentioned = message.mentions.has(client.user.id);
        const isReplyToBot = message.reference && message.mentions.repliedUser?.id === client.user.id;
        const isEveryoneMention = message.mentions.everyone;

        if (isBotMentioned && !message.author.bot && !isReplyToBot && !isEveryoneMention) {
            // Kanał dozwolony dla wszystkich
            const allowedChannelId = '1207041051831832586';

            // Sprawdź czy to dozwolony kanał LUB użytkownik jest adminem
            const isAllowedChannel = message.channel.id === allowedChannelId;
            const isAdmin = aiChatService.isAdmin(message.member);

            if (!isAllowedChannel && !isAdmin) {
                await message.reply('⚠️ AI Chat jest dostępny tylko na specjalnym kanale lub dla administratorów.');
                return;
            }

            // Wyciągnij pytanie (usuń mention bota)
            const question = message.content
                .replace(/<@!?\d+>/g, '') // Usuń wszystkie @mentions
                .trim();

            if (!question || question.length === 0) {
                await message.reply('❓ Zadaj mi jakieś pytanie!');
                return;
            }

            if (question.length > 300) {
                await message.reply('⚠️ Pytanie jest za długie (max 300 znaków).');
                return;
            }

            // Sprawdź cooldown
            const canAskResult = aiChatService.canAsk(message.author.id, message.member);
            if (!canAskResult.allowed) {
                await message.reply(`⏳ Musisz poczekać ${canAskResult.remainingMinutes} min przed następnym pytaniem.`);
                return;
            }

            // Typing indicator
            await message.channel.sendTyping();

            // Zadaj pytanie AI
            const result = await aiChatService.ask(message, question);

            // Zapisz cooldown
            aiChatService.recordAsk(message.author.id, message.member);

            // Wyślij odpowiedź z przyciskami feedbacku (jeśli użyto bazy wiedzy)
            const replyOptions = { content: result.content };

            if (result.relevantKnowledge) {
                const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ai_feedback_up').setEmoji('👍').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('ai_feedback_down').setEmoji('👎').setStyle(ButtonStyle.Danger)
                );
                replyOptions.components = [row];
            }

            const reply = await message.reply(replyOptions);

            // Zapamiętaj kontekst do oceny (auto-cleanup po 10 min)
            if (result.relevantKnowledge) {
                feedbackMap.set(reply.id, { knowledge: result.relevantKnowledge, askerId: message.author.id, question });
                setTimeout(() => feedbackMap.delete(reply.id), 10 * 60 * 1000);
            }

            return; // Zakończ handler - nie przetwarzaj dalej
        }

        // === THREAD HANDLER (tylko jeśli nie AI Chat) ===
        // Sprawdź czy to wątek w kanale szkoleniowym
        if (!message.channel.isThread()) return;
        if (message.channel.parentId !== config.channels.training) return;

        // Sprawdź czy to bot
        if (message.author.bot) return;

        // Pobierz właściciela wątku z thread.ownerId (ustawiane automatycznie przez Discord)
        let threadOwnerId = message.channel.ownerId;

        // Jeśli brak ownerId, spróbuj znaleźć właściciela po nazwie wątku w cache
        if (!threadOwnerId) {
            logger.warn(`⚠️ Wątek nie ma ownerId, szukam po nazwie: ${message.channel.name}`);

            const threadName = message.channel.name;
            const guild = message.guild;

            // Szukaj w cache (bez fetchowania!)
            const threadOwner = guild.members.cache.find(member =>
                member.displayName === threadName || member.user.username === threadName
            );

            if (!threadOwner) {
                logger.warn(`⚠️ Nie znaleziono właściciela wątku w cache: ${threadName}`);
                return;
            }

            threadOwnerId = threadOwner.id;
            logger.info(`✅ Znaleziono właściciela w cache: ${threadOwner.displayName} (${threadOwnerId})`);
        }

        // Sprawdź czy to właściciel wątku pisze
        if (message.author.id !== threadOwnerId) return;

        logger.info(`👤 Wiadomość od właściciela wątku: ${message.author.tag}`);

        // Sprawdź czy to pierwsza wiadomość właściciela w tym wątku
        // Pobierz ostatnie 100 wiadomości z wątku
        const messages = await message.channel.messages.fetch({ limit: 100 });

        // Policz wiadomości właściciela (nie licząc wiadomości bota)
        const ownerMessagesCount = messages.filter(msg =>
            msg.author.id === threadOwnerId && !msg.author.bot
        ).size;

        logger.info(`📊 Liczba wiadomości właściciela: ${ownerMessagesCount}`);

        // Jeśli to pierwsza wiadomość właściciela - wyślij ping do ról klanowych
        if (ownerMessagesCount === 1) {
            await message.channel.send(
                config.messages.ownerNeedsHelp(threadOwnerId, config.roles.clan)
            );

            logger.info(`📢 Wysłano ping do ról klanowych w wątku: ${message.channel.name}`);
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi wiadomości w wątku:', error);
    }
});

client.on('error', error => {
    logger.error(`Błąd klienta Discord: ${error.message}`);
});

process.on('unhandledRejection', error => {
    logger.error(`Nieobsłużone odrzucenie Promise: ${error.message}`);
});

process.on('uncaughtException', error => {
    logger.error(`Nieobsłużony wyjątek: ${error.message}`);
    process.exit(1);
});

module.exports = {
    client,
    start: () => {
        return client.login(config.token);
    },
    stop: () => {
        return client.destroy();
    }
};