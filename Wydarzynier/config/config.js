const path = require('path');
const fs = require('fs');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Odczyt lokalnego .env bezpośrednio - process.env.ROBOT jest współdzielony między botami
const localEnv = require('dotenv').parse(fs.readFileSync(path.join(__dirname, '../.env')));

const requiredEnvVars = [
    'WYDARZYNIER_TOKEN',
    'WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik .env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    // Dane połączenia
    token: process.env.WYDARZYNIER_TOKEN,

    // Przekazywanie wiadomości z priv na kanał (robot3)
    robot3Users: localEnv.ROBOT ? localEnv.ROBOT.split(',').map(id => id.trim()) : [],
    notificationForwardChannel: process.env.ROBOT3_FORWARD_CHANNEL || '1486848827997818900',
    mentionRoleId: process.env.ROBOT3_MENTION_ROLE || '1486506395057524887',
    robot3ActivationChannel: process.env.ROBOT3_ACTIVATION_CHANNEL || '1486510519119773818',

    // Kanały
    channels: {
        party: process.env.WYDARZYNIER_PARTY_CHANNEL || '1201206524165496994'
    },

    // System Przypomnień i Eventów
    notificationsBoardChannelId: process.env.WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL,
    timezone: 'Europe/Warsaw',
    maxNotificationsPerUser: 50,
    maxTotalNotifications: 200,

    // Role
    roles: {
        partyNotifications: process.env.WYDARZYNIER_PARTY_NOTIFICATIONS_ROLE || '1272573347946954833'
    },

    // Emoji
    emoji: {
        party: '<:I_Party:1400207104685510853>',
        ticket: '<:L_PartyTicket:1400207169194037410>',
        pin: '<:N_SSS:1275068676508356640>' // Emoji do przypinania w bazarze
    },

    // Nagrody specjalne (czerwone skrzynki) - kolejność = kolejność przycisków
    rewards: [
        { key: 'petaw',   name: 'Pet AW',              emoji: '<:II_PetAW:1407383326830104658>' },
        { key: 'rc',      name: 'RC',                  emoji: '<:II_RC:1385139885924421653>' },
        { key: 'chip',    name: 'Chip',                emoji: '<:II_Chip:1402532787059294229>' },
        { key: 'aw',      name: 'AW',                  emoji: '<:II_AW:1402532745804124242>' },
        { key: 'collred', name: 'Czerwona kolekcja',   emoji: '<:J_CollRed:1402533014080065546>' },
        { key: 'mcore',   name: 'Mount Core',          emoji: '<:II_MountCore:1492137886680748113>' },
        { key: 'csel',    name: 'Chest Core Selector', emoji: '<:J_ChestCoreSelector:1402533058548338741>' },
        { key: 'pcryst',  name: 'Pet Crystal',         emoji: '<:JJ_PetCrystal:1409859481000607784>' },
        { key: 'pshard',  name: 'Panda Shard',         emoji: '<:IG_PandaShard:1402533951511461940>' }
    ],

    // Ustawienia lobby
    lobby: {
        maxPlayers: 7, // Założyciel + 6 osób
        rewardPromptDelay: 60 * 1000, // 1 minuta od zapełnienia lobby - pytanie o nagrodę specjalną
        discussionTime: 15 * 60 * 1000, // 15 minut w ms po zapełnieniu
        maxDuration: 15 * 60 * 1000, // 15 minut maksymalny czas trwania lobby
        fullLobbyDuration: 15 * 60 * 1000, // 15 minut po zapełnieniu lobby
        warningTime: 5 * 60 * 1000, // 5 minut przed usunięciem - ostrzeżenie
        repositionInterval: 5 * 60 * 1000, // 5 minut - interwał repozycjonowania ogłoszeń
        threadName: (username) => `🎉 ${username} - Party Lobby`
    },

    // Wiadomości
    messages: {
        lobbyCreated: (userId) =>
            `<@${userId}> to Twoje lobby.\nPoniżej otrzymasz propozycje dołączenia do Twojego party.\nMożesz akceptować bądź odrzucać chętnych.\nWybierz 6 chętnych, masz na to 15 minut, po tym czasie wątek lobby zostanie usunięty.\n\n💡 **Komendy właściciela:**\n• \`/party-add @użytkownik\` - dodaj gracza bezpośrednio do lobby\n• \`/party-kick @użytkownik\` - usuń gracza z lobby\n• \`/party-close\` - zamknij lobby\n\n🎁 **Nagrody specjalne (dla wszystkich w party):**\n• \`/rewards\` - Twoje nagrody (widoczne tylko dla Ciebie): osobno te z party i te dopisane samodzielnie, a przyciskami **+1** / **-1** poprawiasz wyłącznie te dopisane samodzielnie\n• \`/stats\` - ranking nagród zdobytych w party na serwerze`,

        partyAnnouncement: (displayName, currentPlayers, maxPlayers) =>
            `# ${displayName} stworzył/a lobby i szuka osób do <@&1272573347946954833> <:I_Party:1400207104685510853> (${currentPlayers}/${maxPlayers})`,

        partyAnnouncementReposition: (displayName, currentPlayers, maxPlayers) =>
            `# ${displayName} stworzył/a lobby i szuka osób do Party <:I_Party:1400207104685510853> (${currentPlayers}/${maxPlayers})`,

        joinRequest: (displayName) =>
            `${displayName} chce dołączyć do party. Czy chcesz na to pozwolić?`,

        playerAdded: (userId) =>
            `<@${userId}> zostałeś/aś dodany/a do party!`,

        playerRejected:
            'Osoba zakładająca party nie wyraziła zgody na Twoje dołączenie. Spróbuj następnym razem!',

        lobbyFull:
            '# Lobby zapełnione!\nMacie 15 minut, po tym czasie zostanie usunięte! Bawcie się dobrze <a:peepParty:1400241867421122730>\nJeżeli chcesz otrzymywać powiadomienia o kolejnych party kliknij przycisk poniżej.',

        lobbyWarning: (ownerId) =>
            `⚠️ **Uwaga!** <@${ownerId}> Za 5 minut lobby zostanie zamknięte!`,

        lobbyFullEphemeral:
            'To lobby jest już pełne! Spróbuj dołączyć do innego.',

        rewardPrompt:
            '## Jeżeli trafiłeś czerwoną skrzynkę w tym losowaniu kliknij przycisk odpowiadający nagrodzie.\n*Jeżeli nie trafiłeś nie klikaj nic żeby nie zaburzyć statystyk!*',

        rewardConfirmation: (rewardName, rewardEmoji) =>
            `Czy na pewno otrzymałeś taką nagrodę w tym losowaniu? ${rewardEmoji} **${rewardName}**`,

        rewardAccepted: (rewardName, rewardEmoji) =>
            `✅ Doliczono nagrodę ${rewardEmoji} **${rewardName}** na Twoje konto!`,

        rewardDenied:
            'Nie klikaj w przyciski jeżeli nie dostałeś czerwonej nagrody. To jest system do zliczania Twoich wygranych, żebyś na koniec eventu wiedział ile zarobiłeś!',

        rewardAlreadyClaimed:
            'W tym losowaniu zgłosiłeś już swoją nagrodę. Jeżeli to pomyłka, zgłoś się do administratora.',

        rewardAnnouncement: (userId, rewardEmoji) =>
            `# <@${userId}> właśnie zgarnął nagrodę specjalną! ${rewardEmoji}.\nJeżeli chcesz zobaczyć ranking nagród na serwerze użyj \`/stats\``,

        channelOnly:
            'Ta komenda może być używana tylko na wyznaczonym kanale!',

        ownerOnly:
            'Tylko założyciel lobby może używać tych przycisków!'
    }
};
