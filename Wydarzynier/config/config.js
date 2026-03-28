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
    notificationForwardChannel: '1486848827997818900',
    mentionRoleId: localEnv.WYDARZYNIER_MENTION_ROLE_ID || null,

    // Kanały
    channels: {
        party: '1201206524165496994' // Kanał gdzie można używać /party
    },

    // System Przypomnień i Eventów
    notificationsBoardChannelId: process.env.WYDARZYNIER_NOTIFICATIONS_BOARD_CHANNEL,
    timezone: 'Europe/Warsaw',
    boardUpdateInterval: 60000, // 1 minuta
    maxNotificationsPerUser: 50,
    maxTotalNotifications: 200,
    
    // Role
    roles: {
        partyNotifications: '1272573347946954833' // Rola powiadomień o party
    },
    
    // Emoji
    emoji: {
        party: '<:I_Party:1400207104685510853>',
        ticket: '<:L_PartyTicket:1400207169194037410>',
        pin: '<:N_SSS:1275068676508356640>' // Emoji do przypinania w bazarze
    },
    
    // Ustawienia lobby
    lobby: {
        maxPlayers: 7, // Założyciel + 6 osób
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
            `<@${userId}> to Twoje lobby.\nPoniżej otrzymasz propozycje dołączenia do Twojego party.\nMożesz akceptować bądź odrzucać chętnych.\nWybierz 6 chętnych, masz na to 15 minut, po tym czasie wątek lobby zostanie usunięty.\n\n💡 **Komendy właściciela:**\n• \`/party-add @użytkownik\` - dodaj gracza bezpośrednio do lobby\n• \`/party-kick @użytkownik\` - usuń gracza z lobby\n• \`/party-close\` - zamknij lobby`,
        
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
        
        channelOnly: 
            'Ta komenda może być używana tylko na wyznaczonym kanale!',
        
        ownerOnly: 
            'Tylko założyciel lobby może używać tych przycisków!'
    }
};