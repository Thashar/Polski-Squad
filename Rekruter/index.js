const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('fs').promises;
const path = require('path');

const config = require('./config/config');
const { delay } = require('./utils/helpers');
const { handleInteraction, registerSlashCommands } = require('./handlers/interactionHandlers');
const { handleMessage } = require('./handlers/messageHandlers');
const RoleMonitoringService = require('./services/roleMonitoringService');
const MemberNotificationService = require('./services/memberNotificationService');
const MemberCacheService = require('./services/memberCacheService');
const ClanRoleChangeService = require('./services/clanRoleChangeService');
const { initializeOCR } = require('./services/ocrService');
const { createBotLogger } = require('../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

// Inicjalizacja serwisów
const roleMonitoringService = new RoleMonitoringService(config);
const memberNotificationService = new MemberNotificationService(config);
const memberCacheService = new MemberCacheService(config);
const clanRoleChangeService = new ClanRoleChangeService(config);

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
    logger.success('✅ Rekruter gotowy - rekrutacja z OCR, boost tracking');
    
    // Rejestracja komend slash
    await registerSlashCommands(client, config);
    
    // Inicjalizacja serwisów
    await roleMonitoringService.initialize(client);
    memberNotificationService.initialize(client);
    await memberCacheService.initialize(client);
    clanRoleChangeService.initialize(client);
    await initializeOCR(config);
    
    // Inicjalizacja folderu temp
    try {
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
    } catch (error) {
        // Folder exists
    }
    
    // Czyszczenie starych wiadomości i wysyłanie nowej
    const channel = client.channels.cache.get(MONITORED_CHANNEL_ID);
    if (channel) {
        
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
    try {
        await handleInteraction(interaction, sharedState, config, client);
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

client.on('messageCreate', async message => {
    await handleMessage(message, sharedState, config, client, MONITORED_CHANNEL_ID);
});

// Obsługa dołączenia nowego członka
client.on('guildMemberAdd', async member => {
    await memberNotificationService.handleMemberJoin(member);
});

// Obsługa opuszczenia serwera przez członka
client.on('guildMemberRemove', async member => {
    await memberNotificationService.handleMemberLeave(member);
});

// Obsługa boost events i zmian ról klanowych
client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
        logger.info(`[MEMBER_UPDATE] Wykryto zmianę członka: ${newMember.user.tag}`);

        // Obsługa zmian ról klanowych
        await clanRoleChangeService.handleRoleChange(oldMember, newMember);

        // NOWY SYSTEM: Użyj MemberCacheService do prawidłowego wykrywania zmian boost
        const cacheResult = await memberCacheService.handleMemberUpdate(oldMember, newMember);

        if (cacheResult.changed) {
            if (cacheResult.changeType === 'gained') {
                // Nowy boost!
                logger.info(`[BOOST] 🎉 Nowy boost od ${newMember.user.tag} (${newMember.id})`);
                await handleNewBoost(cacheResult.member);
            } else if (cacheResult.changeType === 'lost') {
                // Utrata boosta!
                logger.info(`[BOOST] 💔 Utrata boost od ${newMember.user.tag} (${newMember.id})`);
                await handleLostBoost(cacheResult.member);
            }
        }
    } catch (error) {
        logger.error(`[BOOST] ❌ Błąd podczas obsługi boost event dla ${newMember?.user?.tag || 'nieznany'}:`, error);
        logger.error(`[BOOST] ❌ Stack trace:`, error.stack);
    }
});

/**
 * Obsługuje nowy boost od członka
 * @param {GuildMember} member - Członek który zboostował
 */
async function handleNewBoost(member) {
    logger.info(`[BOOST] 🎉 Nowy boost od ${member.user.tag}`);
    
    try {
        const guild = member.guild;
        const memberCount = guild.memberCount;
        
        
        // 10 sentencji boost
        const boostMessages = [
            `🧟‍♂️ Boost zebrany! ${member} jak prawdziwy strateg wybiera najlepsze wzmocnienia - dzięki Tobie serwer ma teraz legendarną moc! ${memberCount}+ członków podziwia Twoją hojność!`,
            `💎 To lepsze niż 100k gemów! ${member} dropnął nam najrzadszy boost w całej historii serwera! Twoja szczodrość podnosi nas na wyższy poziom!`,
            `⚡ Wzmocnienie aktywne! Dzięki ${member} mamy teraz nieskończone możliwości - Twój boost czyni naszą społeczność niepokonaną!`,
            `🎯 Perfekcyjne trafienie! ${member} wie dokładnie, jak wesprzeć społeczność - Twój boost to strzał w dziesiątkę prosto w serce serwera!`,
            `🔄 Nadchodzi nowa fala wyzwań, ale z ${member} w naszych szeregach jesteśmy nie do pokonania! Twój boost zawsze na czas!`,
            `📱 Jednym gestem ${member} zmienia wszystko na lepsze! Twoja mądrość i hojność robią z tego serwera prawdziwy bastion!`,
            `🎮 Kolejny poziom odblokowany! To ${member} prowadzi nas do zwycięstwa - Twój boost to klucz do naszego sukcesu!`,
            `🏃‍♂️ Podczas gdy inni uciekają od problemów, ${member} je rozwiązuje boostami! Jesteś naszym bohaterem społeczności!`,
            `⭐ ${member} ma oko do najlepszych wyborów! Twój boost dowodzi, że jesteś prawdziwym liderem z wielkim sercem dla społeczności!`,
            `🔋 ${member} to nasz główny bohater! Twój boost napędza cały serwer i pokazuje, że jesteś jednym z najcenniejszych członków tej społeczności!`
        ];
        
        // Wybierz losową sentencję
        const randomIndex = Math.floor(Math.random() * boostMessages.length);
        const randomMessage = boostMessages[randomIndex];
        
        // Wyślij na kanał główny
        const mainChannelId = '1170323972173340744';
        
        try {
            const mainChannel = client.channels.cache.get(mainChannelId);
            if (!mainChannel) {
                logger.error(`[BOOST] ❌ Nie znaleziono kanału głównego (${mainChannelId}) w cache`);
                
                // Spróbuj pobrać kanał z API
                const fetchedMainChannel = await client.channels.fetch(mainChannelId);
                if (fetchedMainChannel) {
                    await fetchedMainChannel.send(randomMessage);
                } else {
                    logger.error(`[BOOST] ❌ Nie udało się pobrać kanału głównego z API`);
                }
            } else {
                await mainChannel.send(randomMessage);
            }
        } catch (mainChannelError) {
            logger.error(`[BOOST] ❌ Błąd wysyłania na kanał główny:`, mainChannelError);
            logger.error(`[BOOST] ❌ Stack trace (main channel):`, mainChannelError.stack);
        }
        
        // Wyślij na kanał bonusowy
        const bonusChannelId = '1384597663378440363';
        
        try {
            const bonusChannel = client.channels.cache.get(bonusChannelId);
            const bonusMessage = `${member} bardzo nam miło, że wspierasz nasz serwer. Chcemy się Tobie odwdzięczyć dlatego przygotowaliśmy kilka bonusów, które umilą Ci tu pobyt. Zapoznaj się z nimi tutaj: https://discord.com/channels/1170323970692743240/1283802643789250673/1283803231008456724\n\nW sprawie indywidualnej roli kontaktuj się tutaj z właścicielem serwera. <:PepeOK:1185134659286347886>`;
            
            if (!bonusChannel) {
                logger.error(`[BOOST] ❌ Nie znaleziono kanału bonusowego (${bonusChannelId}) w cache`);
                
                // Spróbuj pobrać kanał z API
                const fetchedBonusChannel = await client.channels.fetch(bonusChannelId);
                if (fetchedBonusChannel) {
                    await fetchedBonusChannel.send(bonusMessage);
                } else {
                    logger.error(`[BOOST] ❌ Nie udało się pobrać kanału bonusowego z API`);
                }
            } else {
                await bonusChannel.send(bonusMessage);
            }
        } catch (bonusChannelError) {
            logger.error(`[BOOST] ❌ Błąd wysyłania na kanał bonusowy:`, bonusChannelError);
            logger.error(`[BOOST] ❌ Stack trace (bonus channel):`, bonusChannelError.stack);
        }
        
        logger.info(`[BOOST] ✅ Wysłano wiadomości boost dla ${member.user.tag}`);
        
    } catch (error) {
        logger.error(`[BOOST] ❌ Ogólny błąd podczas obsługi nowego boost dla ${member.user.tag}:`, error);
        logger.error(`[BOOST] ❌ Stack trace (general):`, error.stack);
    }
}

/**
 * Obsługuje utratę boosta przez członka
 * @param {GuildMember} member - Członek który stracił boost
 */
async function handleLostBoost(member) {
    logger.info(`[BOOST] 💔 Utrata boost od ${member.user.tag}`);
    
    try {
        // 10 smutnych sentencji dla utraty boosta
        const lostBoostMessages = [
            `💔 Game over... ${member} zakończył swoją misję wsparcia serwera. Dziękujemy za każdy dzień Twojego boosta - zniknął jak ostatnia amunicja w magazynie, ale Twoja hojność pozostanie w pamięci!`,
            `😢 Połączenie utracone! ${member} opuścił nasze szeregi boosterów. Dziękujemy za cały czas wspierania - jak gdy skończy się energia w grze, musimy poczekać na Twój powrót!`,
            `🌫️ Mgła opadła na serwer... ${member} zabrał ze sobą swój boost. Dziękujemy za wszystkie miesiące/tygodnie wsparcia - Twoja legendarną moc zniknęła z naszego arsenału, ale wspomnienia zostają!`,
            `⚰️ Boost nie przeżył tej rundy! ${member} zakończył wspieranie serwera. Dziękujemy za ten wspaniały okres - jak stracona życiówka, zostały nam tylko wspomnienia Twojej niesamowitej hojności!`,
            `🥀 Koniec epoki! ${member} przestał nas boostować. Dziękujemy za bycie jednym z naszych najlepszych obrońców przez ten czas - Twoje wsparcie było jak rzadki artefakt!`,
            `💸 Klejnoty przepadły! ${member} wycofał swój boost z naszego serwera. Dziękujemy za każdy dzień wspierania - 100k gemów nie wróci, ale wdzięczność za Twój wkład pozostanie na zawsze!`,
            `🛡️ Tarcza opuszczona! ${member} przestał chronić nasz serwer swoim boostem. Dziękujemy za ochronę którą nam dawałeś - bez Twojego wsparcia będzie nam trudniej, ale pamiętamy Twoje poświęcenie!`,
            `🌙 Noc nadeszła dla boosta! ${member} zakończył swoją przygodę ze wspieraniem serwera. Dziękujemy za bycie naszym światłem przez ten czas - ciemność ogarnia społeczność, ale Twój wkład świeci dalej!`,
            `⏰ Czas minął! ${member} przestał boostować nasz serwer. Dziękujemy za każdą minutę Twojego wsparcia - jak gdy kończy się timer w grze, wszystko wraca do punktu wyjścia, ale pamięć trwa!`,
            `💀 Bohater upadł! ${member} nie jest już naszym boosterem. Dziękujemy za cały okres bycia jednym z najcenniejszych członków - czy kiedyś powrócisz do gry? Zawsze będziesz mile widziany!`
        ];
        
        // Wybierz losową smutną sentencję
        const randomIndex = Math.floor(Math.random() * lostBoostMessages.length);
        const randomMessage = lostBoostMessages[randomIndex];
        
        // Wyślij na kanał główny (ten sam co dla nowych boostów)
        const mainChannelId = '1170323972173340744';
        
        try {
            const mainChannel = client.channels.cache.get(mainChannelId);
            if (!mainChannel) {
                const fetchedMainChannel = await client.channels.fetch(mainChannelId);
                if (fetchedMainChannel) {
                    await fetchedMainChannel.send(randomMessage);
                } else {
                    logger.error(`[BOOST] ❌ Nie udało się pobrać kanału głównego`);
                }
            } else {
                await mainChannel.send(randomMessage);
            }
        } catch (mainChannelError) {
            logger.error(`[BOOST] ❌ Błąd wysyłania smutnej wiadomości na kanał główny:`, mainChannelError);
            logger.error(`[BOOST] ❌ Stack trace (lost boost main channel):`, mainChannelError.stack);
        }
        
        logger.info(`[BOOST] ✅ Wysłano wiadomość o utracie boost dla ${member.user.tag}`);
        
    } catch (error) {
        logger.error(`[BOOST] ❌ Ogólny błąd podczas obsługi utraty boost dla ${member.user.tag}:`, error);
        logger.error(`[BOOST] ❌ Stack trace (lost boost general):`, error.stack);
    }
}

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
    logger.info('Zamykanie bota Rekruter...');
    
    await memberCacheService.cleanup();
    
    client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Otrzymano sygnał SIGTERM, zamykam bota Rekruter...');
    
    try {
        await memberCacheService.cleanup();
        
        client.destroy();
        logger.info('Bot Rekruter został pomyślnie zamknięty');
        process.exit(0);
    } catch (error) {
        logger.error(`Błąd podczas zamykania bota Rekruter: ${error.message}`);
        process.exit(1);
    }
});

client.login(config.token);
