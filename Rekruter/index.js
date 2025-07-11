const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');
const { delay } = require('./utils/helpers');
const { handleInteraction } = require('./handlers/interactionHandlers');
const { handleMessage } = require('./handlers/messageHandlers');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

// Globalne mapy stanu
const userStates = new Map();
const userInfo = new Map();
const nicknameRequests = new Map();
const userEphemeralReplies = new Map();
const pendingQualifications = new Map();
const userImages = new Map();
const pendingOtherPurposeFinish = new Map(); // Nowa mapa dla ścieżki "inne cele"

const MONITORED_CHANNEL_ID = config.channels.recruitment;

// Obiekt zawierający wszystkie współdzielone stany
const sharedState = {
    userStates,
    userInfo,
    nicknameRequests,
    userEphemeralReplies,
    pendingQualifications,
    userImages,
    pendingOtherPurposeFinish,
    client,
    config
};

client.once('ready', async () => {
    logger.info(`[BOT] ✅ Bot zalogowany jako ${client.user.tag}`);
    logger.info(`[BOT] Data uruchomienia: ${new Date().toLocaleString('pl-PL')}`);
    
    // Inicjalizacja folderu temp
    try {
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        logger.info(`[BOT] ✅ Utworzono folder temp`);
    } catch (error) {
        logger.info(`[BOT] Folder temp już istnieje`);
    }
    
    // Czyszczenie starych wiadomości i wysyłanie nowej
    const channel = client.channels.cache.get(MONITORED_CHANNEL_ID);
    if (channel) {
        logger.info(`[BOT] Znaleziono kanał rekrutacji: ${channel.name}`);
        
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            const botMessages = messages.filter(msg =>
                msg.author.id === client.user.id &&
                msg.content === config.messages.initialQuestion &&
                msg.components.length > 0
            );
            
            logger.info(`[BOT] Znaleziono ${botMessages.size} starych wiadomości bota do usunięcia`);
            
            for (const [messageId, message] of botMessages) {
                try {
                    await message.delete();
                    logger.info(`[BOT] Usunięto starą wiadomość ${messageId}`);
                } catch (deleteError) {
                    logger.info(`[BOT] Nie udało się usunąć wiadomości ${messageId}`);
                }
            }
        } catch (error) {
            logger.error(`[BOT] ❌ Błąd podczas czyszczenia kanału:`, error);
        }
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('not_polish')
                    .setLabel('Nie, nie jestem Polakiem')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:PepeNie:1185134768464076831>'),
                new ButtonBuilder()
                    .setCustomId('yes_polish')
                    .setLabel('Oczywiście, że tak!')
                    .setStyle(ButtonStyle.Primary)
                    .setEmoji('<:peepoxYes:461067799427547136>')
            );
        
        await channel.send({
            content: config.messages.initialQuestion,
            components: [row]
        });
        
        logger.info(`[BOT] ✅ Wysłano wiadomość rekrutacyjną`);
    } else {
        logger.error(`[BOT] ❌ Nie znaleziono kanału rekrutacji`);
    }
});

client.on('interactionCreate', async interaction => {
    await handleInteraction(interaction, sharedState, config, client);
});

client.on('messageCreate', async message => {
    await handleMessage(message, sharedState, config, client, MONITORED_CHANNEL_ID);
});

client.login(config.token);
