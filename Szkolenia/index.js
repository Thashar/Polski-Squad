const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require('discord.js');
const cron = require('node-cron');

const config = require('./config/config');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { handleReactionAdd } = require('./handlers/reactionHandlers');
const { checkThreads, reminderStorage } = require('./services/threadService');
const { createBotLogger } = require('../utils/consoleLogger');
const AIChatService = require('./services/aiChatService');
const KnowledgeService = require('./services/knowledgeService');

const logger = createBotLogger('Szkolenia');

// Rola kuratora wiedzy i kanał zatwierdzania
const KNOWLEDGE_CURATOR_ROLE = '1470702781638901834';
const APPROVAL_CHANNEL_ID = '1470703877924978772';
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
const knowledgeService = new KnowledgeService();
const aiChatService = new AIChatService(config, knowledgeService);

// Mapa feedbacku AI (messageId -> { knowledge, askerId, question })
const feedbackMap = new Map();

const sharedState = {
    lastReminderMap,
    client,
    config,
    aiChatService,
    knowledgeService,
    feedbackMap
};

client.once(Events.ClientReady, async () => {
    logger.info(`Bot zalogowany jako ${client.user.tag}`);
    logger.info(`Aktywny na ${client.guilds.cache.size} serwerach`);

    client.guilds.cache.forEach(guild => {
        logger.info(`- ${guild.name} (${guild.id})`);
    });

    // Załaduj dane
    try {
        lastReminderMap = await reminderStorage.loadReminders();
        sharedState.lastReminderMap = lastReminderMap;
    } catch (error) {
        logger.error('❌ Błąd ładowania danych przypomień:', error.message);
    }

    await knowledgeService.load();
    await registerSlashCommands(client);

    logger.success('✅ Szkolenia gotowy - wątki szkoleniowe, baza wiedzy, AI Chat');

    await checkThreads(client, sharedState, config, true);

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

    // Obsługa reakcji ✅ (baza wiedzy)
    try {
        if (user.bot) return;

        // Fetch partials
        if (reaction.partial) {
            try { await reaction.fetch(); } catch { return; }
        }
        if (reaction.message.partial) {
            try { await reaction.message.fetch(); } catch { return; }
        }

        if (reaction.emoji.name !== '✅') return;

        const message = reaction.message;
        const channelId = message.channel.id;

        // --- ✅ na kanale zatwierdzania → deaktywuj wpis ---
        if (channelId === APPROVAL_CHANNEL_ID) {
            const result = await knowledgeService.deactivateByApproval(message.id);
            if (result && result.entry.reactedById) {
                // -2 punkty za odrzucenie wiedzy
                await knowledgeService.addPoints(result.entry.reactedById, result.entry.reactedBy, -2);
                logger.info(`📋 Wpis zatwierdzony (deaktywowany): ${result.messageId} przez ${user.tag} | -2 pkt dla ${result.entry.reactedBy}`);
            } else if (result) {
                logger.info(`📋 Wpis zatwierdzony (deaktywowany): ${result.messageId} przez ${user.tag}`);
            }
            return;
        }

        // --- ✅ na innym kanale → dodaj do bazy wiedzy ---
        // Sprawdź rolę kuratora
        const guild = message.guild;
        if (!guild) return;

        let member;
        try {
            member = await guild.members.fetch(user.id);
        } catch { return; }

        if (!member.roles.cache.has(KNOWLEDGE_CURATOR_ROLE)) return;

        // Pobierz treść wiadomości
        let content = message.content || '';
        const authorName = message.member?.displayName || message.author?.username || 'Nieznany';

        // Dołącz linki do załączników (zdjęcia, pliki)
        if (message.attachments?.size > 0) {
            const attachmentLinks = message.attachments.map(a => a.url).join('\n');
            content = content ? `${content}\n${attachmentLinks}` : attachmentLinks;
        }

        // Jeśli to odpowiedź → pobierz pytanie (z załącznikami)
        if (message.reference) {
            try {
                const referencedMsg = await message.fetchReference();
                let refContent = referencedMsg.content || '';
                if (referencedMsg.attachments?.size > 0) {
                    const refAttachments = referencedMsg.attachments.map(a => a.url).join('\n');
                    refContent = refContent ? `${refContent}\n${refAttachments}` : refAttachments;
                }
                if (refContent.trim()) {
                    content = `Pytanie: ${refContent}\nOdpowiedź: ${content}`;
                }
            } catch (err) {
                // Nie udało się pobrać - zachowaj samą odpowiedź
            }
        }

        if (!content.trim()) return;

        // Dodaj do bazy wiedzy
        const reactorName = member.displayName || user.username;
        const added = await knowledgeService.addEntry(
            message.id,
            content,
            authorName,
            reactorName,
            user.id
        );

        if (!added) return; // Już istnieje

        // +1 punkt za dodanie wiedzy
        await knowledgeService.addPoints(user.id, reactorName, 1);

        logger.info(`📚 Dodano do bazy wiedzy: "${content.substring(0, 60)}..." przez ${user.tag}`);

        // Wyślij na kanał zatwierdzania
        try {
            const approvalChannel = await client.channels.fetch(APPROVAL_CHANNEL_ID);
            if (approvalChannel) {
                const embed = new EmbedBuilder()
                    .setTitle('📚 Nowy wpis do bazy wiedzy')
                    .setDescription(content.length > 4000 ? content.substring(0, 4000) + '...' : content)
                    .addFields(
                        { name: 'Autor wiadomości', value: authorName, inline: true },
                        { name: 'Dodał do bazy', value: member.displayName || user.username, inline: true }
                    )
                    .setFooter({ text: `Zaznacz ✅ aby usunąć z bazy wiedzy` })
                    .setTimestamp()
                    .setColor(0x2ecc71);

                // Link do oryginalnej wiadomości
                if (message.url) {
                    embed.addFields({ name: 'Źródło', value: `[Przejdź do wiadomości](${message.url})` });
                }

                const approvalMsg = await approvalChannel.send({ embeds: [embed] });

                // Zapisz ID wiadomości na kanale zatwierdzania
                await knowledgeService.setApprovalMsgId(message.id, approvalMsg.id);
            }
        } catch (error) {
            logger.error(`❌ Błąd wysyłania na kanał zatwierdzania: ${error.message}`);
        }

    } catch (error) {
        logger.error(`❌ Błąd obsługi reakcji ✅ (add): ${error.message}`);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        if (user.bot) return;

        // Fetch partials
        if (reaction.partial) {
            try { await reaction.fetch(); } catch { return; }
        }
        if (reaction.message.partial) {
            try { await reaction.message.fetch(); } catch { return; }
        }

        if (reaction.emoji.name !== '✅') return;

        const message = reaction.message;
        const channelId = message.channel.id;

        // --- ✅ usunięta z kanału zatwierdzania → reaktywuj wpis ---
        if (channelId === APPROVAL_CHANNEL_ID) {
            const result = await knowledgeService.reactivateByApproval(message.id);
            if (result) {
                logger.info(`📋 Wpis reaktywowany: ${result.messageId} przez ${user.tag}`);
            }
            return;
        }

        // --- ✅ usunięta z oryginalnej wiadomości → usuń z bazy ---
        const guild = message.guild;
        if (!guild) return;

        let member;
        try {
            member = await guild.members.fetch(user.id);
        } catch { return; }

        if (!member.roles.cache.has(KNOWLEDGE_CURATOR_ROLE)) return;

        const removedEntry = await knowledgeService.removeEntry(message.id, user.id);
        if (removedEntry) {
            // -1 punkt tylko jeśli wpis był aktywny (nie odrzucony na kanale zatwierdzania)
            if (removedEntry.active) {
                await knowledgeService.addPoints(user.id, member.displayName || user.username, -1);
                logger.info(`🗑️ Usunięto z bazy wiedzy: wiadomość ${message.id} przez ${user.tag} | -1 pkt`);
            } else {
                logger.info(`🗑️ Usunięto z bazy wiedzy (już odrzucony): wiadomość ${message.id} przez ${user.tag} | 0 pkt`);
            }
        }

    } catch (error) {
        logger.error(`❌ Błąd obsługi reakcji ✅ (remove): ${error.message}`);
    }
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
                await message.reply(`⏳ Musisz poczekać ${canAskResult.remainingMinutes} min przed następnym pytaniem.`);
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

            let row = null;
            if (result.relevantKnowledge) {
                const { ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
                row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('ai_feedback_up').setEmoji('👍').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('ai_feedback_down').setEmoji('👎').setStyle(ButtonStyle.Danger)
                );
            }

            // Pierwsza część jako reply
            const firstReplyOptions = { content: parts[0] };
            if (parts.length === 1 && row) firstReplyOptions.components = [row];
            const reply = await message.reply(firstReplyOptions);

            // Kolejne części jako follow-up wiadomości
            for (let i = 1; i < parts.length; i++) {
                const followUpOptions = { content: parts[i] };
                if (i === parts.length - 1 && row) followUpOptions.components = [row];
                await message.channel.send(followUpOptions);
            }

            if (result.relevantKnowledge) {
                feedbackMap.set(reply.id, { knowledge: result.relevantKnowledge, askerId: message.author.id, question });

                // Po 5 min usuń przyciski i dane feedbacku
                setTimeout(async () => {
                    feedbackMap.delete(reply.id);
                    try {
                        await reply.edit({ components: [] });
                    } catch { /* wiadomość już usunięta lub edytowana */ }
                }, 5 * 60 * 1000);
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
