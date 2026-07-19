const { Client, GatewayIntentBits, Partials, Events } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads, reminderStorage } = require('./services/threadService');
const { createBotLogger } = require('../utils/consoleLogger');
const AIChatService = require('./services/aiChatService');

const logger = createBotLogger('Szkolenia');

/**
 * Usuwa polskie znaki diakrytyczne i zamienia tekst na małe litery.
 * @param {string} text
 * @returns {string}
 */
function normalizePolish(text) {
    return text
        .toLowerCase()
        .replace(/ó/g, 'o')
        .replace(/[żź]/g, 'z')
        .replace(/ę/g, 'e')
        .replace(/ą/g, 'a')
        .replace(/ł/g, 'l')
        .replace(/ś/g, 's')
        .replace(/ć/g, 'c')
        .replace(/ń/g, 'n');
}

/**
 * Wykrywa czy w wiadomości pada dowolna odmiana słowa "pomóc"/"pomoc"
 * (pomocy, pomoże, pomożesz, pomogę, pomógł, pomagać itd.).
 * @param {string} text
 * @returns {boolean}
 */
function containsHelpRequest(text) {
    if (!text) return false;
    const normalized = normalizePolish(text);
    // Rdzenie po normalizacji: pomoc/pomocy (pomo+c), pomoz/pomoze (pomo+z),
    // pomoge/pomogl (pomo+g), pomaga/pomagac (pomag)
    return /pomo[czg]|pomag/.test(normalized);
}

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

    try {
        await registerSlashCommands(client);
    } catch (error) {
        logger.error('❌ Błąd rejestracji komend Szkolenia:', error);
    }

    logger.success('✅ Szkolenia gotowy - wątki szkoleniowe, AI Chat');

    try {
        await checkThreads(client, sharedState, config, true);
    } catch (error) {
        logger.error('❌ Błąd sprawdzania wątków przy starcie:', error);
    }

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
            const isAllowedChannel = message.channel.id === config.channels.aiChat;
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

        // Ustal właściciela wątku: najpierw z zapisanych danych, potem po nazwie wątku,
        // a na końcu z ownerId kanału (z pominięciem bota, który tworzy wątki)
        let threadData = sharedState.lastReminderMap.get(message.channel.id);
        let threadOwnerId = threadData ? threadData.ownerId : null;

        if (!threadOwnerId) {
            const threadOwner = message.guild.members.cache.find(member =>
                member.displayName === message.channel.name || member.user.username === message.channel.name
            );
            if (threadOwner) {
                threadOwnerId = threadOwner.id;
            } else if (message.channel.ownerId && message.channel.ownerId !== client.user.id) {
                threadOwnerId = message.channel.ownerId;
            }
        }

        if (!threadOwnerId) {
            logger.warn(`⚠️ Nie ustalono właściciela wątku: ${message.channel.name}`);
            return;
        }

        // Reaguj tylko na wiadomości właściciela wątku
        if (message.author.id !== threadOwnerId) return;

        // Ping o pomoc wysyłamy tylko raz na cykl otwarcia wątku
        if (threadData && threadData.helpPingSent) return;

        // Ping tylko gdy właściciel prosi o pomoc (dowolna odmiana słowa "pomóc")
        if (!containsHelpRequest(message.content)) return;

        // Upewnij się, że istnieje wpis w mapie (np. dla wątków sprzed zmiany),
        // aby trwale zapamiętać że ping został już wysłany
        if (!threadData) {
            const now = Date.now();
            await reminderStorage.setReminder(sharedState.lastReminderMap, message.channel.id, now, now, threadOwnerId);
        }

        await message.channel.send(
            config.messages.ownerNeedsHelp(threadOwnerId, config.roles.clan)
        );
        await reminderStorage.markHelpPingSent(sharedState.lastReminderMap, message.channel.id);
        logger.info(`📢 Wysłano ping do ról klanowych (prośba o pomoc) w wątku: ${message.channel.name}`);

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
