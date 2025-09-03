const path = require('path');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const requiredEnvVars = [
    'SZKOLENIA_DISCORD_TOKEN',
    'SZKOLENIA_CHANNEL_ID',
    'SZKOLENIA_PING_ROLE_ID'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    logger.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    logger.error('Sprawdź plik .env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
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
        threadLockDays: 7, // Zmieniono: threadDeleteDays -> threadLockDays (wątki są zamykane, nie usuwane)
        inactiveReminderHours: 24,
        checkIntervalMinutes: 60
    },
    
    // Wiadomości
    messages: {
        threadCreated: (userId, roleId, targetUserId) => 
            `<@${userId}> założył wątek z prośbą o <@&${roleId}>\n\n<@${targetUserId}> - to Twój wątek!\n\n## Prześlij zdjęcia:\n\n**ITEMY**\n- zawartości całego plecaka 🎒 \n\n**EQ**\n- EQ postaci oraz itemów poniżej <:H_SSLance:1279199357194862683> <:I_VNeck:1209754519689502720> \n\n**TECH PARTY**\n- założonych Tech Partów <:J_EpicTechSelector:1402533245672886293> \n- poszczególnych Tech Partów oraz poziomu Resonans <a:EternalDurian:1271243234588364877> \n- wszystkich posiadanych Tech Partów <:J_LegandaryTechSelector:1402533631385141258>\n\n**COLLECTIBLES**\n-  czerwonych collectible <:J_CollRed:1402533014080065546> \n- żółtych collectible <:J_CollYellow:1402532951492657172> \n- ukończonych collection sets \n\n**PETY i XENO PETY**\n- posiadanych petów <:K_PetRex:1259960034054635562> \n- poziomów awaken wszystkich petów <:M_StarRed:1259958133963620484> \n- posiadanych xeno petów <:K_SPetCappy:1407637574427873361>\n- poziomy awaken wszystkich xeno petów <:M_StarRed:1259958133963620484> \n\n**POSTACIE**\n- zbiorowe wszystkich postaci <:G_SurvivorPanda:1209754434918154251> <:G_SurvivorMetalia:1260685301056278709> <:G_SurvivorJoey:1326511743555600451> \n- poziomów awaken wszystkich posiadanych postaci <:G_SurvivorTaloxa:1401318994425811065> \n- synergii postaci\n\n**TRYBY GRY**\n- progresu w Path of Trials (PoT)\n- progresu w Main Challange\n\nDodatkowo informację na temat **SUMY POSZCZEGÓLNYCH ITEMÓW** (trzeba cofnąć upgrate itemów, partów, petów i policzyć. <:II_AW:1402532745804124242> trzeba policzyć bez cofania)\n- <:II_AW:1402532745804124242> \n- <:II_Chip:1402532787059294229> \n- <:II_PetAW:1407383326830104658> \n- <:II_RC:1385139885924421653>`,
        
        threadExists: (targetUserId, userId, roleId) => 
            `<@${targetUserId}> - to Twój wątek!\n<@${userId}> założył wątek, z prośbą o <@&${roleId}>\n<@${targetUserId}> wrzuć tu wszystko o co chcesz zapytać i poczekaj na odpowiedź.\nGdy już dowiesz się wszystkiego, dziękując możesz zamknąć ten wątek <:P_FrogMaszRacje:1341894087598669985>`,
        
        threadLocked: 'Wątek zostanie zablokowany. Dziękuję za skorzystanie z pomocy! 🐸💚',
        
        threadKeptOpen: 'Ok, wątek pozostanie otwarty. Przypomnę o zamknięciu za 24h jeśli nie będzie aktywności!',
        
        ownerOnly: 'Tylko właściciel wątku może użyć tych przycisków!',
        
        inactiveReminder: (userId) => 
            `<@${userId}> Twój wątek jest nieaktywny od 24 godzin. Czy mogę go zamknąć?`
    }
};