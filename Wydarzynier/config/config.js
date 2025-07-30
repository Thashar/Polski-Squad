const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const requiredEnvVars = [
    'WYDARZYNIER_TOKEN'
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
    
    // Kanały
    channels: {
        party: '1201206524165496994' // Kanał gdzie można używać /party
    },
    
    // Role
    roles: {
        partyNotifications: '1272573347946954833' // Rola powiadomień o party
    },
    
    // Emoji
    emoji: {
        party: '<:I_Party:1400207104685510853>',
        ticket: '<:I_Ticket:1400207169194037410>'
    },
    
    // Ustawienia lobby
    lobby: {
        maxPlayers: 6, // Założyciel + 5 osób
        discussionTime: 15 * 60 * 1000, // 15 minut w ms po zapełnieniu
        maxDuration: 60 * 60 * 1000, // 1 godzina maksymalny czas trwania lobby
        warningTime: 5 * 60 * 1000, // 5 minut przed usunięciem - ostrzeżenie
        threadName: (username) => `🎉 ${username} - Party Lobby`
    },
    
    // Wiadomości
    messages: {
        lobbyCreated: (userId) => 
            `<@${userId}> to Twoje lobby.\nPoniżej otrzymasz propozycje dołączenia do Twojego party.\nMożesz akceptować bądź odrzucać chętnych.\nPo wybraniu 5 chętnych będziecie mieli 15 min na rozmowę tutaj, po tym czasie wątek zostanie usunięty.`,
        
        partyAnnouncement: (displayName, currentPlayers, maxPlayers) => 
            `# ${displayName} stworzył/a lobby i szuka osób do <@&1272573347946954833> <:I_Party:1400207104685510853> (${currentPlayers}/${maxPlayers})\nZostaw reakcję poniżej by dołączyć.`,
        
        joinRequest: (displayName) => 
            `${displayName} chce dołączyć do party. Czy chcesz na to pozwolić?`,
        
        playerAdded: (userId) => 
            `<@${userId}> zostałeś/aś dodany/a do party!`,
        
        playerRejected: 
            'Osoba zakładająca party nie wyraziła zgody na Twoje dołączenie. Spróbuj następnym razem!',
        
        lobbyFull: 
            '# Lobby zapełnione!\nMacie 1h od utworzenia tego lobby, po tym czasie zostanie usunięte! Bawcie się dobrze <a:peepParty:1400241867421122730>\nJeżeli chcesz otrzymywać powiadomienia o kolejnych party kliknij przycisk poniżej.',
        
        lobbyWarning: 
            '⚠️ **Uwaga!** Za 5 minut lobby zostanie zamknięte!',
        
        lobbyFullEphemeral: 
            'To lobby jest już pełne! Spróbuj dołączyć do innego.',
        
        channelOnly: 
            'Ta komenda może być używana tylko na wyznaczonym kanale!',
        
        ownerOnly: 
            'Tylko założyciel lobby może używać tych przycisków!'
    }
};