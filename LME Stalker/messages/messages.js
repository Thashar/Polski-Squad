const client = require('../index');
const config = require('../config/config');

/**
 * Funkcja do wysyłania ostrzeżeń na odpowiedni kanał
 */
async function sendWarningMessage(userId, points, roleId, guildId) {
    console.log(`\n🚨 ==================== WYSYŁANIE OSTRZEŻENIA ====================`);
    console.log(`👤 Użytkownik: ${userId}`);
    console.log(`📊 Punkty: ${points}`);
    console.log(`🎭 Rola użytkownika: ${roleId}`);
    console.log(`🏰 Serwer: ${guildId}`);
    
    if (points !== 3 && points !== 5) {
        console.log(`ℹ️ Nie wysyłam ostrzeżenia dla ${points} punktów (tylko dla 3 i 5)`);
        return;
    }
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.error('❌ Nie znaleziono serwera dla ostrzeżenia');
            return;
        }
        
        console.log(`✅ Znaleziono serwer: ${guild.name}`);
        
        const warningChannelId = config.WARNING_CHANNELS[roleId];
        if (!warningChannelId) {
            console.error(`❌ Nie znaleziono kanału ostrzeżeń dla roli: ${roleId}`);
            console.log('🔍 Dostępne kanały ostrzeżeń:', config.WARNING_CHANNELS);
            return;
        }
        
        console.log(`📢 Kanał ostrzeżeń dla roli ${roleId}: ${warningChannelId}`);
        
        let channel = guild.channels.cache.get(warningChannelId);
        if (!channel) {
            console.log(`⚠️ Kanał nie w cache, próbuję pobrać z API...`);
            try {
                channel = await guild.channels.fetch(warningChannelId);
                if (!channel) {
                    console.error(`❌ Nie znaleziono kanału: ${warningChannelId}`);
                    return;
                }
                console.log(`✅ Pobrano kanał z API: ${channel.name}`);
            } catch (fetchError) {
                console.error('❌ Błąd podczas pobierania kanału:', fetchError);
                return;
            }
        } else {
            console.log(`✅ Znaleziono kanał w cache: ${channel.name}`);
        }
        
        const permissions = channel.permissionsFor(guild.members.me);
        if (!permissions.has('SendMessages')) {
            console.error(`❌ Bot nie ma uprawnień do pisania na kanale ${channel.name}`);
            return;
        }
        
        let message = '';
        if (points === 3) {
            message = `# <@${userId}> 3 razy w przeciągu miesiąca nie zbił bossa. Nadano rolę kutasa!`;
            console.log('📝 Przygotowano wiadomość dla 3 punktów');
        } else if (points === 5) {
            message = `# <@${userId}> 5 razy w przeciągu miesiąca nie zbił bossa. Zablokowano start w przyszłych loteriach Glory Member.`;
            console.log('📝 Przygotowano wiadomość dla 5 punktów');
        }
        
        if (message) {
            console.log(`📤 Wysyłanie wiadomości na kanał ${channel.name}: "${message}"`);
            
            await channel.send(message);
            
            console.log(`✅ Pomyślnie wysłano ostrzeżenie dla ${points} punktów na kanał ${channel.name} (${channel.id})`);
        } else {
            console.log('❌ Brak wiadomości do wysłania');
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas wysyłania ostrzeżenia:', error);
        console.error('📋 Szczegóły błędu:', {
            name: error.name,
            message: error.message,
            code: error.code,
            status: error.status
        });
    }
}

/**
 * Wiadomości błędów
 */
const ERROR_MESSAGES = {
    NO_PERMISSION: '❌ Nie masz uprawnień do używania tej komendy!',
    INVALID_IMAGE: '❌ Musisz załączyć poprawny plik obrazu!',
    INVALID_CATEGORY: '❌ Nieprawidłowa kategoria!',
    OCR_ERROR: '❌ Wystąpił błąd podczas analizy zdjęcia. Spróbuj ponownie.',
    RANKING_ERROR: '❌ Wystąpił błąd podczas pobierania rankingu.',
    POINTS_ERROR: '❌ Wystąpił błąd podczas przetwarzania żądania.',
    DEBUG_ERROR: '❌ Wystąpił błąd podczas debugowania ról.'
};

/**
 * Wiadomości sukcesu
 */
const SUCCESS_MESSAGES = {
    POINTS_ADDED: (username, points, newPoints) => `✅ Pomyślnie dodano ${points} punktów użytkownikowi **${username}**. Nowy stan: ${newPoints} punktów.`,
    POINTS_REMOVED: (username, points, newPoints) => `✅ Pomyślnie odjęto ${points} punktów użytkownikowi **${username}**. Pozostało: ${newPoints} punktów.`,
    USER_REMOVED: (username) => `✅ Użytkownik **${username}** został całkowicie usunięty z rankingu.`,
    USER_NOT_FOUND: (username) => `❌ Użytkownik **${username}** nie znajdował się w rankingu.`
};

module.exports = {
    sendWarningMessage,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES
};
