const path = require('path');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Szkolenia');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const requiredEnvVars = [
    'SZKOLENIA_DISCORD_TOKEN',
    'SZKOLENIA_CHANNEL_ID',
    'SZKOLENIA_PING_ROLE_ID',
    'SZKOLENIA_CLAN_ROLE_0',
    'SZKOLENIA_CLAN_ROLE_1',
    'SZKOLENIA_CLAN_ROLE_2',
    'SZKOLENIA_CLAN_ROLE_MAIN'
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
        training: process.env.SZKOLENIA_CHANNEL_ID,
        aiChat: process.env.SZKOLENIA_AI_CHAT_CHANNEL_ID || '1207041051831832586'
    },

    // Role administracyjne (dla AI Chat - brak limitów)
    adminRoles: [
        '1196911721588199464',
        '1196586785413795850',
        '1170332302715396106',
        '1170332127653531698',
        '1268527148394610730'
    ],

    // Role
    roles: {
        ping: process.env.SZKOLENIA_PING_ROLE_ID,
        // Role autoryzowane do otwierania wątków innym (admin/moderator/specjalne)
        authorized: [
            '1196911721588199464',
            '1196586785413795850',
            '1170332302715396106',
            '1170332127653531698',
            '1268527148394610730'
        ],
        // Role klanowe - użytkownicy z tymi rolami mogą otwierać wątki sobie
        clan: [
            process.env.SZKOLENIA_CLAN_ROLE_0,
            process.env.SZKOLENIA_CLAN_ROLE_1,
            process.env.SZKOLENIA_CLAN_ROLE_2,
            process.env.SZKOLENIA_CLAN_ROLE_MAIN
        ]
    },
    
    // Ustawienia reakcji i wątków
    reaction: {
        name: 'N_SSS'
    },
    
    // Ustawienia czasowe (w dniach/godzinach)
    timing: {
        threadArchiveDays: 1,
        threadLockDays: 14, // Automatyczne zamknięcie po 14 dniach nieaktywności
        threadReminderDays: 7, // Pytanie o zamknięcie po 7 dniach nieaktywności
        checkHour: 18, // Godzina sprawdzania wątków (18:00)
        checkMinute: 0 // Minuta sprawdzania wątków (00)
    },
    
    // Wiadomości
    messages: {
        threadCreated: (userId, roleId, targetUserId) =>
            `<@${userId}> założył wątek z prośbą o <@&${roleId}>\n\n<@${targetUserId}> - to Twój wątek!\n\nWejdź na stronę: https://sio-tools.exp0.dev/ \nWypełnij wszystko zgodnie ze swoimi statystykami konta w grze. \nNa końcu kliknij przycisk "Share" na samej górze strony, a następnie prześlij link do swojego profilu TUTAJ.\n\n## Dodatkowo prześlij zdjęcia:\n\n**CORE STOCK**\n- zdjęcie swojego Core Stock (menu wyświetlające ilość wszystkich dostępnych core na koncie, hamburger u góry po lewej stronie EQ postaci) - <:II_AW:1402532745804124242> <:II_Chip:1402532787059294229> <:II_PetAW:1407383326830104658> <:II_RC:1385139885924421653> <:II_MountCore:1492137886680748113> <:II_TransmuteCore:1458440558602092647> \n\n**ITEMY**\n- zawartości całego plecaka 🎒 \n\n**EQ**\n- itemów poniżej <:H_SSLance:1279199357194862683> <:I_VNeck:1209754519689502720> postaci i EQ.\n\n**TECH PARTY**\n- wszystkich posiadanych Tech Partów <:J_LegandaryTechSelector:1402533631385141258> poniżej drzewka tech partów.\n\n**TRYBY GRY**\n- progresu w Path of Trials (PoT)\n- progresu w Main Challange\n\n**Jeżeli nikt nie odpowiada możesz jednorazowo poprosić o pomoc bota, pisząc np. "pomocy".**`,
        
        threadLocked: 'Wątek zostanie zablokowany. Dziękuję za skorzystanie z pomocy! 🐸💚',
        
        threadKeptOpen: 'Ok, wątek pozostanie otwarty. Przypomnę o zamknięciu za 7 dni jeśli nie będzie aktywności!',
        
        ownerOnly: 'Tylko właściciel wątku może użyć tych przycisków!',
        
        inactiveReminder: (userId) =>
            `<@${userId}> Twój wątek jest nieaktywny od 7 dni. Czy mogę go zamknąć?\nJeśli nie odpowiesz, wątek zostanie automatycznie zamknięty za kolejne 7 dni.`,

        threadAlreadyOpen: (userId) =>
            `<@${userId}> Twój wątek jest wciąż otwarty. Możesz z niego korzystać.`,

        ownerNeedsHelp: (userId, clanRoles) =>
            `<@${userId}> prosi o pomoc! ${clanRoles.map(roleId => `<@&${roleId}>`).join(' ')}`
    }
};