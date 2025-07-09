const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const requiredEnvVars = [
    'SZKOLENIA_DISCORD_TOKEN',
    'SZKOLENIA_CHANNEL_ID',
    'SZKOLENIA_PING_ROLE_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    console.error('Sprawdź plik .env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

module.exports = {
    // Dane połączenia
    token: process.env.SZKOLENIA_DISCORD_TOKEN,
    
    // Kanały
    channels: {
        training: process.env.SZKOLENIA_CHANNEL_ID
    },
    
    // Role
    roles: {
        ping: process.env.SZKOLENIA_PING_ROLE_ID,
        authorized: [
            '1196911721588199464',
            '1196586785413795850', 
            '1170332302715396106',
            '1170332127653531698',
            '1268527148394610730'
        ]
    },
    
    // Ustawienia reakcji i wątków
    reaction: {
        name: 'N_SSS'
    },
    
    // Ustawienia czasowe (w dniach/godzinach)
    timing: {
        threadArchiveDays: 1,
        threadDeleteDays: 7,
        inactiveReminderHours: 24,
        checkIntervalMinutes: 60
    },
    
    // Wiadomości
    messages: {
        threadCreated: (userId, roleId, targetUserId) => 
            `<@${userId}> założył wątek z prośbą o <@&${roleId}>\n\n<@${targetUserId}> - to Twój wątek!\nPrześlij poniżej wszystkie wymagane screeny do analizy, napisz w czym problem?`,
        
        threadExists: (targetUserId, userId, roleId) => 
            `<@${targetUserId}> - to Twój wątek!\n<@${userId}> założył wątek, z prośbą o <@&${roleId}>\n<@${targetUserId}> wrzuć tu wszystko o co chcesz zapytać i poczekaj na odpowiedź.\nGdy już dowiesz się wszystkiego, dziękując możesz zamknąć ten wątek <:P_FrogMaszRacje:1341894087598669985>`,
        
        threadLocked: 'Wątek zostanie zablokowany. Dziękuję za skorzystanie z pomocy! 🐸💚',
        
        threadKeptOpen: 'Ok, wątek pozostanie otwarty. Przypomnę o zamknięciu za 24h jeśli nie będzie aktywności!',
        
        ownerOnly: 'Tylko właściciel wątku może użyć tych przycisków!',
        
        inactiveReminder: (userId) => 
            `<@${userId}> Twój wątek jest nieaktywny od 24 godzin. Czy mogę go zamknąć?`
    }
};