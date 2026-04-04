const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads, reminderStorage } = require('./services/threadService');
const { createBotLogger } = require('../utils/consoleLogger');
const AIChatService = require('./services/aiChatService');

const logger = createBotLogger('Szkolenia');

const AI_CHAT_CHANNEL_ID = '1207041051831832586';

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

// Inicjalizacja serwisów
const aiChatService = new AIChatService(config);

const sharedState = {
    lastReminderMap,
    client,
    config,
    aiChatService
};

client.once(Events.ClientReady, async () => {
    // Załaduj dane
    try {
        lastReminderMap = await reminderStorage.loadReminders();
        sharedState.lastReminderMap = lastReminderMap;
    } catch (error) {
        logger.error('❌ Błąd ładowania danych przypomień:', error.message);
    }

    // Policz wątki szkoleniowe
    try {
        const guild = client.guilds.cache.first();
        const channel = await guild.channels.fetch(config.channels.training);
        const activeThreads = await channel.threads.fetchActive();
        const archivedThreads = await channel.threads.fetchArchived();
        logger.info(`🧵 Wątki szkoleniowe: ${activeThreads.threads.size} otwartych, ${archivedThreads.threads.size} zamkniętych`);
    } catch (error) {
        logger.error('❌ Błąd pobierania wątków:', error.message);
    }

    await registerSlashCommands(client);

    logger.success('✅ Szkolenia gotowy - wątki szkoleniowe, AI Chat');

    await checkThreads(client, sharedState, config, true);

    const cronExpression = `${config.timing.checkMinute} ${config.timing.checkHour} * * *`;
    cron.schedule(cronExpression, () => {
        logger.info(`🕐 Rozpoczynam zaplanowane sprawdzanie wątków (${config.timing.checkHour}:${config.timing.checkMinute.toString().padStart(2, '0')})`);
        checkThreads(client, sharedState, config);
    }, {
        timezone: "Europe/Warsaw"
    });
});

client.on(Events.InteractionCreate, async (interaction) => {
    try {
        await handleInteraction(interaction, sharedState, config);
    } catch (error) {
        logger.error('❌ Błąd podczas obsługi interakcji:', error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: '❌ Wystąpił błąd podczas przetwarzania komendy.', ephemeral: true });
            } else if (interaction.deferred) {
                await interaction.editReply({ content: '❌ Wystąpił błąd podczas przetwarzania komendy.' });
            }
        } catch (replyError) {
            logger.error('❌ Nie można odpowiedzieć na interakcję:', replyError.message);
        }
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    // Obsługa reakcji N_SSS (wątki treningowe)
    await handleReactionAdd(reaction, user, sharedState, config);
});

client.on(Events.MessageCreate, async (message) => {
    try {
        // === AI CHAT HANDLER ===
        const isBotMentioned = message.mentions.has(client.user.id);
        const isReplyToBot = message.reference && message.mentions.repliedUser?.id === client.user.id;
        const isEveryoneMention = message.mentions.everyone;

        if (isBotMentioned && !message.author.bot && !isReplyToBot && !isEveryoneMention) {
            const isAllowedChannel = message.channel.id === AI_CHAT_CHANNEL_ID;
            const isAdmin = aiChatService.isAdmin(message.member);

            if (!isAllowedChannel && !isAdmin) {
                await message.reply('⚠️ AI Chat jest dostępny tylko na specjalnym kanale lub dla administratorów.');
                return;
            }

            const question = message.content.replace(/<@!?\d+>/g, '').trim();

            if (!question || question.length === 0) {
                await message.reply('❓ Zadaj mi jakieś pytanie!');
                return;
            }

            if (question.length > 300) {
                await message.reply('⚠️ Pytanie jest za długie (max 300 znaków).');
                return;
            }

            const canAskResult = aiChatService.canAsk(message.author.id, message.member);
            if (!canAskResult.allowed) {
                const timeStr = canAskResult.remainingHours > 0
                    ? `${canAskResult.remainingHours}h ${canAskResult.remainingMinutes}min`
                    : `${canAskResult.remainingMinutes} min`;
                await message.reply(`⏳ Możesz zadać pytanie raz dziennie. Następne za ${timeStr}.`);
                return;
            }

            await message.channel.sendTyping();

            const result = await aiChatService.ask(message, question);
            aiChatService.recordAsk(message.author.id, message.member);

            // Dzielenie długich odpowiedzi na części po max 2000 znaków
            const splitMessage = (text, maxLen = 2000) => {
                if (text.length <= maxLen) return [text];
                const parts = [];
                let remaining = text;
                while (remaining.length > 0) {
                    if (remaining.length <= maxLen) {
                        parts.push(remaining);
                        break;
                    }
                    // Szukaj najlepszego miejsca do podziału
                    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
                    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('\n', maxLen);
                    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf('. ', maxLen);
                    if (splitAt < maxLen * 0.3) splitAt = remaining.lastIndexOf(' ', maxLen);
                    if (splitAt < maxLen * 0.3) splitAt = maxLen;
                    parts.push(remaining.substring(0, splitAt + 1).trimEnd());
                    remaining = remaining.substring(splitAt + 1).trimStart();
                }
                return parts;
            };

            const parts = splitMessage(result.content);

            // Pierwsza część jako reply
            await message.reply({ content: parts[0] });

            // Kolejne części jako follow-up wiadomości
            for (let i = 1; i < parts.length; i++) {
                await message.channel.send({ content: parts[i] });
            }

            return;
        }

        // === THREAD HANDLER ===
        if (!message.channel.isThread()) return;
        if (message.channel.parentId !== config.channels.training) return;
        if (message.author.bot) return;

        let threadOwnerId = message.channel.ownerId;

        if (!threadOwnerId) {
            logger.warn(`⚠️ Wątek nie ma ownerId, szukam po nazwie: ${message.channel.name}`);
            const threadOwner = message.guild.members.cache.find(member =>
                member.displayName === message.channel.name || member.user.username === message.channel.name
            );
            if (!threadOwner) {
                logger.warn(`⚠️ Nie znaleziono właściciela wątku w cache: ${message.channel.name}`);
                return;
            }
            threadOwnerId = threadOwner.id;
            logger.info(`✅ Znaleziono właściciela w cache: ${threadOwner.displayName} (${threadOwnerId})`);
        }

        if (message.author.id !== threadOwnerId) return;

        logger.info(`👤 Wiadomość od właściciela wątku: ${message.author.tag}`);

        const messages = await message.channel.messages.fetch({ limit: 100 });
        const ownerMessagesCount = messages.filter(msg =>
            msg.author.id === threadOwnerId && !msg.author.bot
        ).size;

        logger.info(`📊 Liczba wiadomości właściciela: ${ownerMessagesCount}`);

        if (ownerMessagesCount === 1) {
            await message.channel.send(
                config.messages.ownerNeedsHelp(threadOwnerId, config.roles.clan)
            );
            logger.info(`📢 Wysłano ping do ról klanowych w wątku: ${message.channel.name}`);
        }

    } catch (error) {
        logger.error('❌ Błąd podczas obsługi wiadomości:', error);
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
