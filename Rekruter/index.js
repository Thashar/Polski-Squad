const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

// Załadowanie zmiennych środowiskowych z folderu Rekruter
require('dotenv').config({ path: path.join(__dirname, 'Rekruter', '.env') });


// Walidacja wymaganych zmiennych środowiskowych
const requiredEnvVars = [
    'DISCORD_TOKEN',
    'RECRUITMENT_CHANNEL',
    'CLAN0_CHANNEL',
    'CLAN1_CHANNEL',
    'CLAN2_CHANNEL',
    'MAIN_CLAN_CHANNEL',
    'WELCOME_CHANNEL',
    'NOT_POLISH_ROLE',
    'VERIFIED_ROLE',
    'CLAN0_ROLE',
    'CLAN1_ROLE',
    'CLAN2_ROLE',
    'MAIN_CLAN_ROLE'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
    console.error('❌ Brakujące zmienne środowiskowe:', missingVars.join(', '));
    console.error('Sprawdź plik .env i upewnij się, że wszystkie wymagane zmienne są ustawione.');
    process.exit(1);
}

const config = {
    token: process.env.DISCORD_TOKEN,
    channels: {
        recruitment: process.env.RECRUITMENT_CHANNEL,
        clan0: process.env.CLAN0_CHANNEL,
        clan1: process.env.CLAN1_CHANNEL,
        clan2: process.env.CLAN2_CHANNEL,
        mainClan: process.env.MAIN_CLAN_CHANNEL,
        welcome: process.env.WELCOME_CHANNEL
    },
    roles: {
        notPolish: process.env.NOT_POLISH_ROLE,
        verified: process.env.VERIFIED_ROLE,
        clan0: process.env.CLAN0_ROLE,
        clan1: process.env.CLAN1_ROLE,
        clan2: process.env.CLAN2_ROLE,
        mainClan: process.env.MAIN_CLAN_ROLE
    },
    messages: {
        initialQuestion: "Czy jesteś Polakiem?",
        notPolishDM: "Ten serwer jest tylko dla Polaków, jeśli pomyliłeś się w trakcie ankiety możesz wyjść z serwera i dołączyć jeszcze raz!\n\n# Polski Squad",
        purposeQuestion: "Co Cię do nas sprowadza?",
        rcQuestion: "Ile posiadasz <:I_RC:1385139885924421653>?\nNapisz na czacie dokładną ilość!",
        lunarLevelQuestion: "Na jakim poziomie trudności ostatnio robiłeś/robiłaś **Lunar Mine Expedition**?",
        lunarPointsQuestion: "Ile punktów uzyskałeś/uzyskałaś ostatnio w **I fazie Lunar Mine Expedition**?",
        otherPurposeMessage: "Rozumiem, że szukasz Polskiej społeczności, ale masz już swój klan. Bardzo dobrze trafiłeś!\nZanim dostaniesz dostęp do serwera, musimy sprawdzić o Tobie kilka rzeczy.\n\n**W tym celu wklej na czacie zdjęcie swojej postaci!** Pamiętaj, że zdjęcie musi być screenem z gry i nie może być edytowane!",
        statsQuestion: "Wklej na czacie zdjęcie swojej postaci!",
        invalidRC: "Podaj poprawną ilość RC!",
        invalidLunarLevel: "Podaj poprawny poziom Lunar Mine Expedition (1-12)!",
        invalidLunarPoints: "Podaj poprawną ilość punktów z I fazy Lunar Mine Expedition (0-1500)!",
        invalidEquipmentImage: "❌ To nie jest zdjęcie postaci! Proszę wklej zdjęcie postaci bez obróbki. Musi być widoczny Twój nick, postać oraz EQ!",
        notQualified: "\nWitaj na serwerze!\nNiestety nie kwalifikujesz się do żadnego z naszych klanów :PepeSad:\n\nZostań z nami na serwerze, już niedługo z naszą pomocą osiągniesz odpowiedni poziom. <:PepePOG:1185136709487300669> <#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244> \n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>",
        clan0Welcome: "\n**Aplikujesz do klanu :video_game:PolskiSquad⁰:video_game:**\n\nNa początek potrzebujemy **zdjęcia Twojego EQ,** prześlij nam je tutaj.\nOsoba zajmująca się rekrutacją, jak tylko będzie na pewno się do Ciebie odezwie.\n\n**W międzyczasie zapoznaj się z zasadami klanu:**\n1.〘:trophy:〙Cel minimum 100 pkt. Optymalnie 130 pkt. dla ambitnych.\n2.〘:crossed_swords:〙Aktywny udział w eventach oraz ekspedycjach.\n3.〘:video_game:〙Codzienna aktywność w grze.\n4.〘:calling:〙Codzienna aktywność na discordzie.\n5.〘:loudspeaker:〙Uruchomienie powiadomień o wzmiankach z serwera jest obowiązkowe.\n6.〘:chart_with_upwards_trend:〙Wyraźny progres w grze.\n\nWymagania rekrutacyjne znajdziesz w naszym regulaminie: https://discord.com/channels/1170323970692743240/1170349018900074637 \n\n**W oczekiwaniu na kontakt z naszej strony:**\n<#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244>\n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>\n\nJeśli nadal czekasz na odpowiedź z naszej strony, nie martw się, zazwyczaj nie trwa to długo. Dziękujemy! <:PepeOK:1185134659286347886>",
        clan1Welcome: "\n**Aplikujesz do klanu ⚡Polski Squad¹⚡**\n\nNa początek potrzebujemy **zdjęcia Twojego EQ,** prześlij nam je tutaj.\nOsoba zajmująca się rekrutacją, jak tylko będzie na pewno się do Ciebie odezwie.\n\n**W międzyczasie zapoznaj się z zasadami klanu:**\n1.〘:trophy:〙Cel minimum 100 pkt. Optymalnie 130 pkt. dla ambitnych.\n2.〘:crossed_swords:〙Aktywny udział w eventach oraz ekspedycjach.\n3.〘:video_game:〙Codzienna aktywność w grze.\n4.〘:calling:〙Codzienna aktywność na discordzie.\n5.〘:loudspeaker:〙Uruchomienie powiadomień o wzmiankach z serwera jest obowiązkowe.\n6.〘:chart_with_upwards_trend:〙Wyraźny progres w grze.\n\nWymagania rekrutacyjne znajdziesz w naszym regulaminie: https://discord.com/channels/1170323970692743240/1170349018900074637 \n\n**W oczekiwaniu na kontakt z naszej strony:**\n<#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244>\n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>\n\nJeśli nadal czekasz na odpowiedź z naszej strony, nie martw się, zazwyczaj nie trwa to długo. Dziękujemy! <:PepeOK:1185134659286347886>",
        clan2Welcome: "\n**Aplikujesz do klanu 💥PolskiSquad²💥**\n\nNa początek potrzebujemy **zdjęcia Twojego EQ,** prześlij nam je tutaj.\nOsoba zajmująca się rekrutacją, jak tylko będzie na pewno się do Ciebie odezwie.\n\n**W międzyczasie zapoznaj się z zasadami klanu:**\n1.〘:trophy:〙Cel minimum 100 pkt. Optymalnie 130 pkt. dla ambitnych.\n2.〘:crossed_swords:〙Aktywny udział w eventach oraz ekspedycjach.\n3.〘:video_game:〙Codzienna aktywność w grze.\n4.〘:calling:〙Codzienna aktywność na discordzie.\n5.〘:loudspeaker:〙Uruchomienie powiadomień o wzmiankach z serwera jest obowiązkowe.\n6.〘:chart_with_upwards_trend:〙Wyraźny progres w grze.\n\nWymagania rekrutacyjne znajdziesz w naszym regulaminie: https://discord.com/channels/1170323970692743240/1170349018900074637 \n\n**W oczekiwaniu na kontakt z naszej strony:**\n<#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244>\n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>\n\nJeśli nadal czekasz na odpowiedź z naszej strony, nie martw się, zazwyczaj nie trwa to długo. Dziękujemy! <:PepeOK:1185134659286347886>",
        mainClanWelcome: "\n**Aplikujesz do klanu 🔥Polski Squad🔥**\n\nNa początek potrzebujemy **zdjęcia Twojego EQ,** prześlij nam je tutaj.\nOsoba zajmująca się rekrutacją, jak tylko będzie na pewno się do Ciebie odezwie.\n\n**W międzyczasie zapoznaj się z zasadami klanu:**\n1.〘:trophy:〙Cel minimum 100 pkt. Optymalnie 130 pkt. dla ambitnych.\n2.〘:crossed_swords:〙Aktywny udział w eventach oraz ekspedycjach.\n3.〘:video_game:〙Codzienna aktywność w grze.\n4.〘:calling:〙Codzienna aktywność na discordzie.\n5.〘:loudspeaker:〙Uruchomienie powiadomień o wzmiankach z serwera jest obowiązkowe.\n6.〘:chart_with_upwards_trend:〙Wyraźny progres w grze.\n\nWymagania rekrutacyjne znajdziesz w naszym regulaminie: https://discord.com/channels/1170323970692743240/1170349018900074637 \n\n**W oczekiwaniu na kontakt z naszej strony:**\n<#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244>\n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>\n\nJeśli nadal czekasz na odpowiedź z naszej strony, nie martw się, zazwyczaj nie trwa to długo. Dziękujemy! <:PepeOK:1185134659286347886>",
        generalWelcome: "\nWitaj na serwerze!\n\n<#1183308580867285152> <a:PepeDziedoberek:1246475492190720241> z nami lub od razu zacznij <#1170323972173340744> <:PepeHahaNoob:1246476180408762548> .\nNa kanale <#1207041051831832586>, możesz wrzucić zdjęcie swojego EQ, sprawdzimy czy można coś poprawić <a:PepeConfused:1246476605614985316> , wytyczymy Ci odpowiednią ścieżkę rozwoju <a:PandaSSJ:1265690596727848963>\nNa kanałach <#1190255710005633174> oraz <#1326501601409761350> możesz ustawić sobie odpowiednie role na serwerze, dzięki którym dostaniesz dostęp do tematycznych kanałów na serwerze. <a:PepePopcorn2:1259556091474481244> \n\nZmień NICK na serwerze na taki jaki masz w grze, jest to bardzo ważne byśmy pozostali w kontakcie! <:PepeOK:1185134659286347886>"
    }
};

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.DirectMessages
    ]
});

const userStates = new Map();
const userInfo = new Map();
const nicknameRequests = new Map();
const userEphemeralReplies = new Map();
const pendingQualifications = new Map();
const userImages = new Map();

const MONITORED_CHANNEL_ID = config.channels.recruitment;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeAddRole(member, roleId) {
    try {
        console.log(`[ROLE] Próba nadania roli ${roleId} użytkownikowi ${member.user.username}`);
        
        const role = member.guild.roles.cache.get(roleId);
        if (role) {
            await member.roles.add(role);
            console.log(`[ROLE] ✅ Pomyślnie nadano rolę ${roleId} użytkownikowi ${member.user.username}`);
        } else {
            console.log(`[ROLE] ❌ Rola ${roleId} nie została znaleziona`);
        }
        
    } catch (error) {
        console.error(`[ROLE] ❌ Błąd podczas nadawania roli ${roleId}:`, error);
    }
}

function normalizeNickname(nickname) {
    const normalized = nickname.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
    console.log(`[NICK] Znormalizowano nick "${nickname}" -> "${normalized}"`);
    return normalized;
}

function areNicknamesSimilar(discordNick, gameNick) {
    const normalizedDiscord = normalizeNickname(discordNick);
    const normalizedGame = normalizeNickname(gameNick);
    
    console.log(`[NICK] Porównywanie nicków: Discord="${normalizedDiscord}" vs Game="${normalizedGame}"`);
    
    if (normalizedDiscord === normalizedGame) {
        console.log(`[NICK] ✅ Nicki są identyczne`);
        return true;
    }
    
    if (normalizedDiscord.includes(normalizedGame) || normalizedGame.includes(normalizedDiscord)) {
        console.log(`[NICK] ✅ Nicki są podobne (jeden zawiera drugi)`);
        return true;
    }
    
    console.log(`[NICK] ❌ Nicki są różne`);
    return false;
}

async function proposeNicknameChange(user, gameNick, member, pendingQualificationData) {
    const discordNick = member.displayName;
    console.log(`[NICK] Propozycja zmiany nicku dla ${user.username}: "${discordNick}" -> "${gameNick}"`);
    
    if (areNicknamesSimilar(discordNick, gameNick)) {
        console.log(`[NICK] Nicki są podobne, pomijam zmianę`);
        if (pendingQualificationData) {
            await sendPendingQualification(user.id, pendingQualificationData);
        }
        return;
    }
    
    if (!userEphemeralReplies.has(user.id)) {
        console.log(`[NICK] Brak ephemeral reply dla użytkownika, pomijam propozycję`);
        if (pendingQualificationData) {
            await sendPendingQualification(user.id, pendingQualificationData);
        }
        return;
    }
    
    if (pendingQualificationData) {
        pendingQualifications.set(user.id, pendingQualificationData);
        console.log(`[NICK] Zapisano odroczoną kwalifikację dla ${user.username}`);
    }
    
    await delay(1000);
    
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`nickname_yes_${user.id}`)
                .setLabel('Tak')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`nickname_no_${user.id}`)
                .setLabel('Nie')
                .setStyle(ButtonStyle.Danger)
        );
    
    nicknameRequests.set(user.id, {
        gameNick: gameNick,
        memberId: member.id,
        guildId: member.guild.id
    });
    
    console.log(`[NICK] Wysłano propozycję zmiany nicku dla ${user.username}`);
    
    await updateUserEphemeralReply(user.id, 
        `Zauważyliśmy, że posiadasz inny nick w grze niż na discordzie.\nWykryty nick w grze: **${gameNick}**\nWymagamy tu używania takiego samego nicku jak w grze, w celu lepszej komunikacji.\n\nCzy zmienić Twój nick?`, 
        [row]
    );
    
    setTimeout(() => {
        if (nicknameRequests.has(user.id)) {
            console.log(`[NICK] Timeout propozycji nicku dla ${user.username}`);
            nicknameRequests.delete(user.id);
            const pendingData = pendingQualifications.get(user.id);
            if (pendingData) {
                sendPendingQualification(user.id, pendingData);
            }
        }
    }, 300000);
}

async function sendPendingQualification(userId, qualificationData) {
    try {
        console.log(`[QUALIFICATION] Wysyłanie odroczonej kwalifikacji dla użytkownika ${userId}`);
        const { member, attack, user, stats } = qualificationData;
        
        const targetChannelId = await assignClanRole(member, attack, user);
        
        if (targetChannelId) {
            await sendUserSummary(user, targetChannelId);
        }
        
        pendingQualifications.delete(userId);
        console.log(`[QUALIFICATION] ✅ Zakończono odroczoną kwalifikację dla użytkownika ${userId}`);
        
    } catch (error) {
        console.error(`[QUALIFICATION] ❌ Błąd podczas wysyłania odroczonej kwalifikacji:`, error);
    }
}

function findNicknameInText(text) {
    console.log(`[OCR] Szukanie nicku w pierwszych 3 linijkach tekstu`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    const maxLines = Math.min(3, lines.length);
    console.log(`[OCR] Sprawdzanie ${maxLines} linii (maksymalnie 3)`);
    
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        console.log(`[OCR] Sprawdzanie linii ${i + 1}: "${line}"`);
        
        const words = line.split(/\s+/);
        const filteredWords = words.filter(word => /[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(word));
        
        if (filteredWords.length > 0) {
            let longestWord = filteredWords[0];
            for (const word of filteredWords) {
                if (word.length > longestWord.length) {
                    longestWord = word;
                }
            }
            
            longestWord = longestWord.replace(/^[^\w\u00C0-\u017F]+|[^\w\u00C0-\u017F]+$/g, '');
            
            if (longestWord && longestWord.length >= 3) {
                console.log(`[OCR] Znaleziono potencjalny nick "${longestWord}" w linii ${i + 1}`);
                return { nickname: longestWord, lineIndex: i };
            }
        }
    }
    
    console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach`);
    return { nickname: null, lineIndex: -1 };
}

async function updateUserEphemeralReply(userId, content, components = []) {
    const userReply = userEphemeralReplies.get(userId);
    if (!userReply) {
        console.log(`[BOT] Brak ephemeral reply dla użytkownika ${userId}`);
        return;
    }
    
    try {
        await userReply.editReply({
            content: content,
            components: components,
            ephemeral: true
        });
        console.log(`[BOT] ✅ Zaktualizowano ephemeral reply dla użytkownika ${userId}`);
    } catch (error) {
        console.error(`[BOT] ❌ Błąd podczas aktualizacji ephemeral reply:`, error);
    }
}

client.once('ready', async () => {
    console.log(`[BOT] ✅ Bot zalogowany jako ${client.user.tag}`);
    console.log(`[BOT] Data uruchomienia: ${new Date().toLocaleString('pl-PL')}`);
    
    try {
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        console.log(`[BOT] ✅ Utworzono folder temp`);
    } catch (error) {
        console.log(`[BOT] Folder temp już istnieje`);
    }
    
    const channel = client.channels.cache.get(MONITORED_CHANNEL_ID);
    if (channel) {
        console.log(`[BOT] Znaleziono kanał rekrutacji: ${channel.name}`);
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            
            const botMessages = messages.filter(msg => 
                msg.author.id === client.user.id && 
                msg.content === config.messages.initialQuestion &&
                msg.components.length > 0
            );
            
            console.log(`[BOT] Znaleziono ${botMessages.size} starych wiadomości bota do usunięcia`);
            
            for (const [messageId, message] of botMessages) {
                try {
                    await message.delete();
                    console.log(`[BOT] Usunięto starą wiadomość ${messageId}`);
                } catch (deleteError) {
                    console.log(`[BOT] Nie udało się usunąć wiadomości ${messageId}`);
                }
            }
            
        } catch (error) {
            console.error(`[BOT] ❌ Błąd podczas czyszczenia kanału:`, error);
        }
        
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('not_polish')
                    .setLabel('Nie, jestem to z przypadku')
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
        
        console.log(`[BOT] ✅ Wysłano wiadomość rekrutacyjną`);
    } else {
        console.error(`[BOT] ❌ Nie znaleziono kanału rekrutacji`);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const userId = interaction.user.id;
    console.log(`[INTERACTION] Otrzymano interakcję ${interaction.customId} od ${interaction.user.username}`);

    try {
        await delay(1000);

        if (interaction.customId.startsWith('nickname_')) {
            const action = interaction.customId.split('_')[1];
            const targetUserId = interaction.customId.split('_')[2];
            
            console.log(`[NICK] Interakcja nicku: ${action} dla użytkownika ${targetUserId}`);
            
            if (userId !== targetUserId) {
                await updateUserEphemeralReply(targetUserId, 'Te przyciski nie są dla Ciebie!');
                return;
            }
            
            const nicknameRequest = nicknameRequests.get(targetUserId);
            if (!nicknameRequest) {
                await updateUserEphemeralReply(targetUserId, 'Ta prośba już wygasła.');
                return;
            }
            
            if (action === 'yes') {
                try {
                    const guild = client.guilds.cache.get(nicknameRequest.guildId);
                    const member = await guild.members.fetch(nicknameRequest.memberId);
                    
                    await member.setNickname(nicknameRequest.gameNick);
                    console.log(`[NICK] ✅ Zmieniono nick użytkownika ${member.user.username} na ${nicknameRequest.gameNick}`);
                    
                    await updateUserEphemeralReply(targetUserId, `✅ Twój nick został zmieniony na: **${nicknameRequest.gameNick}**`);
                    
                } catch (error) {
                    console.error(`[NICK] ❌ Błąd podczas zmiany nicku:`, error);
                    await updateUserEphemeralReply(targetUserId, '❌ Nie udało się zmienić nicku. Sprawdź uprawnienia bota.');
                }
            } else if (action === 'no') {
                console.log(`[NICK] Użytkownik ${targetUserId} odrzucił zmianę nicku`);
                await updateUserEphemeralReply(targetUserId, '✅ Rozumiem. Nick pozostaje bez zmian.');
            }
            
            const pendingData = pendingQualifications.get(targetUserId);
            if (pendingData) {
                await sendPendingQualification(targetUserId, pendingData);
            }
            
            nicknameRequests.delete(targetUserId);
            return;
        }

        switch (interaction.customId) {
            case 'not_polish':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} wskazał że nie jest Polakiem`);
                await handleNotPolish(interaction);
                break;
            case 'yes_polish':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} potwierdził że jest Polakiem`);
                await handleYesPolish(interaction);
                break;
            case 'looking_clan':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} szuka klanu`);
                await handleLookingClan(interaction);
                break;
            case 'other_purpose':
                console.log(`[INTERACTION] Użytkownik ${interaction.user.username} przyszedł w innym celu`);
                await handleOtherPurpose(interaction);
                break;
        }
        
    } catch (error) {
        console.error(`[INTERACTION] ❌ Błąd podczas obsługi interakcji:`, error);
    }
});

client.on('messageCreate', async message => {
    if (message.channel.id !== MONITORED_CHANNEL_ID) {
        return;
    }
    
    if (message.author.bot) return;
    
    const userId = message.author.id;
    const userState = userStates.get(userId);

    console.log(`[MESSAGE] Otrzymano wiadomość od ${message.author.username}: "${message.content.substring(0, 50)}..."`);

    const isUseful = await analyzeMessage(message, userState);
    
    if (!isUseful) {
        console.log(`[MESSAGE] Usuwam bezużyteczną wiadomość od ${message.author.username}`);
        await safeDeleteMessage(message);
    } else {
        console.log(`[MESSAGE] Wiadomość od ${message.author.username} jest przydatna`);
    }
});

async function downloadImage(url, filepath) {
    console.log(`[DOWNLOAD] Rozpoczynam pobieranie obrazu: ${url}`);
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https:') ? https : http;
        const file = require('fs').createWriteStream(filepath);
        
        protocol.get(url, (response) => {
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`[DOWNLOAD] ✅ Pobrano obraz do: ${filepath}`);
                resolve();
            });
        }).on('error', (err) => {
            console.error(`[DOWNLOAD] ❌ Błąd pobierania obrazu:`, err);
            reject(err);
        });
    });
}

async function preprocessImageForWhiteText(inputPath, outputPath) {
    try {
        console.log(`[IMAGE] Przetwarzanie obrazu: ${inputPath} -> ${outputPath}`);
        await sharp(inputPath)
            .grayscale()
            .threshold(200)
            .negate()
            .png()
            .toFile(outputPath);
        console.log(`[IMAGE] ✅ Przetworzono obraz`);
    } catch (error) {
        console.error(`[IMAGE] ❌ Błąd przetwarzania obrazu:`, error);
        throw error;
    }
}

function checkForEquipmentKeyword(text) {
    const lowerText = text.toLowerCase();
    console.log(`[OCR] Sprawdzanie słów kluczowych Equipment w tekście`);
    
    const equipmentKeywords = [
        'equipment',
        'equipement',
        'equipmnt',
        'equip',
        'eq'
    ];
    
    for (const keyword of equipmentKeywords) {
        if (lowerText.includes(keyword)) {
            console.log(`[OCR] ✅ Znaleziono słowo kluczowe: ${keyword}`);
            return true;
        }
    }
    
    console.log(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment`);
    return false;
}

async function extractOptimizedStatsFromImage(imagePath, userId) {
    try {
        console.log(`[OCR] ===== ROZPOCZĘCIE ANALIZY OCR =====`);
        console.log(`[OCR] Użytkownik: ${userId}`);
        console.log(`[OCR] Ścieżka obrazu: ${imagePath}`);
        
        const processedPath = imagePath.replace(/\.(jpg|jpeg|png|gif|bmp)$/i, '_processed.png');
        
        await updateUserEphemeralReply(userId, '🔄 Przetwarzam obraz...');
        console.log(`[OCR] Rozpoczynam preprocessowanie obrazu`);
        await preprocessImageForWhiteText(imagePath, processedPath);
        
        await updateUserEphemeralReply(userId, '🔍 Analizuję obraz...');
        console.log(`[OCR] Rozpoczynam rozpoznawanie tekstu Tesseract`);
        
        const { data: { text } } = await Tesseract.recognize(processedPath, 'pol+eng', {
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄĆĘŁŃÓŚŹŻąćęłńóśźż: +-%.,()/'
        });
        
        console.log(`[OCR] ===== WYNIK TESSERACT =====`);
        console.log(`[OCR] Rozpoznany tekst:`);
        console.log(text);
        console.log(`[OCR] ===============================`);
        
        await fs.unlink(processedPath).catch(() => {});
        
        await updateUserEphemeralReply(userId, '📊 Sprawdzam czy to Equipment...');
        
        const hasEquipment = checkForEquipmentKeyword(text);
        
        if (!hasEquipment) {
            console.log(`[OCR] ❌ Nie znaleziono słów kluczowych Equipment - odrzucam obraz`);
            return { 
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0
            };
        }
        
        await updateUserEphemeralReply(userId, '📊 Analizuję statystyki...');
        console.log(`[OCR] Rozpoczynam analizę statystyk`);
        
        const stats = extractStatsFromLines(text);
        
        if (!stats.playerNick) {
            console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - odrzucam obraz`);
            return { 
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                error: 'NICK_NOT_FOUND_IN_FIRST_3_LINES'
            };
        }
        
        stats.isValidEquipment = true;
        
        console.log(`[OCR] ===== WYNIKI ANALIZY =====`);
        console.log(`[OCR] Nick gracza: ${stats.playerNick}`);
        console.log(`[OCR] Atak postaci: ${stats.characterAttack}`);
        console.log(`[OCR] Pewność: ${stats.confidence}%`);
        console.log(`[OCR] ===========================`);
        
        return stats;
        
    } catch (error) {
        console.error(`[OCR] ❌ Błąd podczas analizy OCR:`, error);
        throw error;
    }
}

function extractStatsFromLines(text) {
    console.log(`[OCR] Rozpoczynam ekstraktację statystyk z tekstu`);
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    console.log(`[OCR] Liczba linii po filtracji: ${lines.length}`);
    
    let playerNick = null;
    let characterAttack = null;
    let nickLineIndex = -1;
    
    const nicknameResult = findNicknameInText(text);
    if (nicknameResult.nickname) {
        playerNick = nicknameResult.nickname;
        nickLineIndex = nicknameResult.lineIndex;
        console.log(`[OCR] Znaleziono nick "${playerNick}" w linii ${nickLineIndex + 1}`);
    } else {
        console.log(`[OCR] ❌ Nie znaleziono nicku w pierwszych 3 linijkach - zwracam błąd`);
        return { 
            playerNick: null, 
            characterAttack: null,
            confidence: 0,
            isValidEquipment: false
        };
    }
    
    if (nickLineIndex >= 0) {
        console.log(`[OCR] Szukanie ataku zaczynając od linii ${nickLineIndex + 2}`);
        
        for (let i = nickLineIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            console.log(`[OCR] Analiza linii ${i + 1} w poszukiwaniu ataku: "${line}"`);
            
            const attackFromLine = extractAttackFromLine(line);
            if (attackFromLine) {
                characterAttack = attackFromLine;
                console.log(`[OCR] Znaleziono atak ${characterAttack} w linii ${i + 1}`);
                break;
            }
        }
    }
    
    if (!characterAttack) {
        console.log(`[OCR] Nie znaleziono ataku w standardowych liniach, przeszukuję cały tekst`);
        const allNumberMatches = text.match(/\b\d+\b/g);
        if (allNumberMatches) {
            console.log(`[OCR] Wszystkie znalezione liczby:`, allNumberMatches);
            const numbers = allNumberMatches
                .map(n => parseInt(n))
                .filter(n => n >= 1000 && n <= 10000000)
                .sort((a, b) => b - a);
            
            console.log(`[OCR] Liczby po filtracji i sortowaniu (1000-10M):`, numbers);
            
            if (numbers.length > 0) {
                if (numbers[0] <= 10000000) {
                    characterAttack = numbers[0];
                    console.log(`[OCR] Wybrano największą liczbę jako atak: ${characterAttack}`);
                } else if (numbers.length > 1 && numbers[1] <= 10000000) {
                    characterAttack = numbers[1];
                    console.log(`[OCR] Pierwsza liczba przekracza limit, wybrano drugą najwyższą: ${characterAttack}`);
                } else {
                    console.log(`[OCR] Wszystkie liczby przekraczają limit lub są nieodpowiednie`);
                }
            }
        }
    }
    
    const result = { 
        playerNick, 
        characterAttack,
        confidence: calculateSimpleConfidence(playerNick, characterAttack),
        isValidEquipment: true
    };
    
    console.log(`[OCR] Finalne wyniki ekstraktacji:`, result);
    return result;
}

function extractAttackFromLine(line) {
    console.log(`[OCR] Ekstraktacja ataku z linii: "${line}"`);
    
    const numberMatches = line.match(/\b\d+\b/g);
    
    if (numberMatches) {
        console.log(`[OCR] Znalezione liczby w linii:`, numberMatches);
        
        for (const numStr of numberMatches) {
            const num = parseInt(numStr);
            console.log(`[OCR] Sprawdzam liczbę: ${num}`);
            
            if (num >= 1000 && num <= 10000000) {
                console.log(`[OCR] ✅ Liczba ${num} mieści się w zakresie ataku`);
                return num;
            } else {
                console.log(`[OCR] ❌ Liczba ${num} poza zakresem ataku (1000-10M)`);
            }
        }
    } else {
        console.log(`[OCR] Nie znaleziono liczb w linii`);
    }
    
    return null;
}

function calculateSimpleConfidence(playerNick, characterAttack) {
    let confidence = 0;
    
    console.log(`[OCR] Kalkulacja pewności:`);
    
    if (playerNick) {
        confidence += 40;
        console.log(`[OCR] + 40 punktów za nick`);
        if (playerNick.length >= 4) {
            confidence += 10;
            console.log(`[OCR] + 10 punktów za długość nicku`);
        }
    }
    
    if (characterAttack) {
        confidence += 50;
        console.log(`[OCR] + 50 punktów za atak`);
        if (characterAttack >= 10000) {
            confidence += 10;
            console.log(`[OCR] + 10 punktów za wysoki atak`);
        }
    }
    
    const finalConfidence = Math.min(confidence, 100);
    console.log(`[OCR] Końcowa pewność: ${finalConfidence}%`);
    
    return finalConfidence;
}

async function analyzeMessage(message, userState) {
    console.log(`[ANALYZE] Analizuję wiadomość w stanie: ${userState?.step || 'brak stanu'}`);
    
    if (userState && userState.step === 'waiting_rc') {
        await handleRCInput(message, userState);
        return true;
    }
    
    if (userState && userState.step === 'waiting_lunar_level') {
        await handleLunarLevelInput(message, userState);
        return true;
    }
    
    if (userState && userState.step === 'waiting_lunar_points') {
        await handleLunarPointsInput(message, userState);
        return true;
    }
    
    if (userState && userState.step === 'waiting_image') {
        await handleImageInput(message, userState);
        return true;
    }
    
    console.log(`[ANALYZE] Wiadomość nie pasuje do żadnego stanu`);
    return false;
}

async function safeDeleteMessage(message) {
    try {
        await message.delete();
        console.log(`[MESSAGE] ✅ Usunięto wiadomość od ${message.author.username}`);
    } catch (error) {
        console.log(`[MESSAGE] ❌ Nie udało się usunąć wiadomości od ${message.author.username}`);
    }
}

async function handleNotPolish(interaction) {
    const member = interaction.member;
    console.log(`[NOT_POLISH] Obsługuję użytkownika ${interaction.user.username} jako nie-Polaka`);
    
    await safeAddRole(member, config.roles.notPolish);

    try {
        await interaction.user.send(config.messages.notPolishDM);
        console.log(`[NOT_POLISH] ✅ Wysłano DM do ${interaction.user.username}`);
    } catch (error) {
        console.log(`[NOT_POLISH] ❌ Nie udało się wysłać DM do ${interaction.user.username}`);
    }

    await interaction.reply({ 
        content: 'Otrzymałeś odpowiednią rolę i wiadomość prywatną.', 
        ephemeral: true 
    });
}

async function handleYesPolish(interaction) {
    console.log(`[YES_POLISH] Inicjalizuję dane dla ${interaction.user.username}`);
    
    userInfo.set(interaction.user.id, {
        username: interaction.user.username,
        isPolish: true,
        purpose: null,
        rcAmount: null,
        lunarLevel: null,
        lunarPoints: null,
        characterAttack: null,
        playerNick: null
    });

    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId('looking_clan')
                .setLabel('Szukam klanu')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:Peperednice:1341085025306808400>'),
            new ButtonBuilder()
                .setCustomId('other_purpose')
                .setLabel('Przyszedłem w innym celu...')
                .setStyle(ButtonStyle.Primary)
                .setEmoji('<:PepeWelcome:1185134579967852605>')
        );

    await interaction.reply({
        content: config.messages.purposeQuestion,
        components: [row],
        ephemeral: true
    });

    userEphemeralReplies.set(interaction.user.id, interaction);
    console.log(`[YES_POLISH] ✅ Zapisano ephemeral reply dla ${interaction.user.username}`);
}

async function handleLookingClan(interaction) {
    console.log(`[LOOKING_CLAN] Użytkownik ${interaction.user.username} szuka klanu`);
    
    const info = userInfo.get(interaction.user.id);
    if (info) {
        info.purpose = 'Szukam klanu';
        userInfo.set(interaction.user.id, info);
    }

    userStates.set(interaction.user.id, { step: 'waiting_rc' });
    console.log(`[LOOKING_CLAN] Ustawiono stan waiting_rc dla ${interaction.user.username}`);

    await updateUserEphemeralReply(interaction.user.id, config.messages.rcQuestion);
}

async function handleOtherPurpose(interaction) {
    console.log(`[OTHER_PURPOSE] Użytkownik ${interaction.user.username} przyszedł w innym celu`);
    
    const info = userInfo.get(interaction.user.id);
    if (info) {
        info.purpose = 'Przyszedłem w innym celu';
        userInfo.set(interaction.user.id, info);
    }

    userStates.set(interaction.user.id, { step: 'waiting_image' });
    console.log(`[OTHER_PURPOSE] Ustawiono stan waiting_image dla ${interaction.user.username}`);
    
    await updateUserEphemeralReply(interaction.user.id, config.messages.otherPurposeMessage);
}

async function handleRCInput(message, userState) {
    const rcAmount = parseInt(message.content);
    
    console.log(`[RC_INPUT] Użytkownik ${message.author.username} podał RC: ${message.content}`);
    
    await safeDeleteMessage(message);

    if (isNaN(rcAmount) || rcAmount < 0 || rcAmount > 500) {
        console.log(`[RC_INPUT] ❌ Nieprawidłowa wartość RC: ${rcAmount}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidRC);
        return;
    }

    console.log(`[RC_INPUT] ✅ Prawidłowa wartość RC: ${rcAmount}`);

    const info = userInfo.get(message.author.id);
    if (info) {
        info.rcAmount = rcAmount;
        userInfo.set(message.author.id, info);
    }

    userStates.set(message.author.id, { step: 'waiting_lunar_level', rcAmount });
    
    await updateUserEphemeralReply(message.author.id, config.messages.lunarLevelQuestion);
}

async function handleLunarLevelInput(message, userState) {
    const lunarLevel = parseInt(message.content);
    
    console.log(`[LUNAR_LEVEL] Użytkownik ${message.author.username} podał poziom Lunar: ${message.content}`);
    
    await safeDeleteMessage(message);

    if (isNaN(lunarLevel) || lunarLevel < 1 || lunarLevel > 12) {
        console.log(`[LUNAR_LEVEL] ❌ Nieprawidłowy poziom Lunar: ${lunarLevel}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidLunarLevel);
        return;
    }

    console.log(`[LUNAR_LEVEL] ✅ Prawidłowy poziom Lunar: ${lunarLevel}`);

    const info = userInfo.get(message.author.id);
    if (info) {
        info.lunarLevel = lunarLevel;
        userInfo.set(message.author.id, info);
    }

    userStates.set(message.author.id, { 
        step: 'waiting_lunar_points', 
        rcAmount: userState.rcAmount,
        lunarLevel 
    });
    
    await updateUserEphemeralReply(message.author.id, config.messages.lunarPointsQuestion);
}

async function handleLunarPointsInput(message, userState) {
    const lunarPoints = parseInt(message.content);
    
    console.log(`[LUNAR_POINTS] Użytkownik ${message.author.username} podał punkty Lunar: ${message.content}`);
    
    await safeDeleteMessage(message);

    if (isNaN(lunarPoints) || lunarPoints < 0 || lunarPoints > 1500) {
        console.log(`[LUNAR_POINTS] ❌ Nieprawidłowe punkty Lunar: ${lunarPoints}`);
        await updateUserEphemeralReply(message.author.id, config.messages.invalidLunarPoints);
        return;
    }

    console.log(`[LUNAR_POINTS] ✅ Prawidłowe punkty Lunar: ${lunarPoints}`);

    const info = userInfo.get(message.author.id);
    if (info) {
        info.lunarPoints = lunarPoints;
        userInfo.set(message.author.id, info);
    }

    userStates.set(message.author.id, { 
        step: 'waiting_image', 
        rcAmount: userState.rcAmount,
        lunarLevel: userState.lunarLevel,
        lunarPoints
    });
    
    await updateUserEphemeralReply(message.author.id, config.messages.statsQuestion);
}

async function handleImageInput(message, userState) {
    console.log(`[IMAGE_INPUT] Użytkownik ${message.author.username} przesłał ${message.attachments.size} załączników`);
    
    if (message.attachments.size === 0) {
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, 'Musisz przesłać zdjęcie!');
        return;
    }

    const attachment = message.attachments.first();
    console.log(`[IMAGE_INPUT] Typ załącznika: ${attachment.contentType}`);
    
    if (!attachment.contentType || !attachment.contentType.startsWith('image/')) {
        console.log(`[IMAGE_INPUT] ❌ Nieprawidłowy typ pliku`);
        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, 'Prześlij prawidłowy obraz!');
        return;
    }

    try {
        await updateUserEphemeralReply(message.author.id, '🚀 Rozpoczynam szybką analizę zdjęcia...');
        
        const tempImagePath = path.join(__dirname, 'temp', `temp_${Date.now()}_${message.author.id}.png`);
        console.log(`[IMAGE_INPUT] Ścieżka tymczasowa: ${tempImagePath}`);
        
        await updateUserEphemeralReply(message.author.id, '📥 Pobieranie obrazu...');
        await downloadImage(attachment.url, tempImagePath);

        userImages.set(message.author.id, tempImagePath);

        const stats = await extractOptimizedStatsFromImage(tempImagePath, message.author.id);

        if (!stats || !stats.isValidEquipment) {
            console.log(`[IMAGE_INPUT] ❌ Obraz nie zawiera prawidłowych danych`);
            await safeDeleteMessage(message);
            
            try {
                await fs.unlink(tempImagePath);
                userImages.delete(message.author.id);
            } catch (error) {}
            
            if (stats && stats.error === 'NICK_NOT_FOUND_IN_FIRST_3_LINES') {
                console.log(`[IMAGE_INPUT] ❌ Nick nie został znaleziony w pierwszych 3 linijkach`);
                await updateUserEphemeralReply(message.author.id, config.messages.invalidEquipmentImage);
            } else {
                await updateUserEphemeralReply(message.author.id, config.messages.invalidEquipmentImage);
            }
            return;
        }

        if (!stats.characterAttack && !stats.playerNick) {
            console.log(`[IMAGE_INPUT] ❌ Nie udało się odczytać danych z obrazu`);
            await safeDeleteMessage(message);
            await updateUserEphemeralReply(message.author.id, '❌ Nie udało się odczytać danych z obrazu. Spróbuj z lepszej jakości zdjęciem.');
            return;
        }

        console.log(`[IMAGE_INPUT] ✅ Pomyślnie przeanalizowano obraz`);

        const info = userInfo.get(message.author.id);
        if (info) {
            info.characterAttack = stats.characterAttack || null;
            info.playerNick = stats.playerNick || 'Nieznany';
            userInfo.set(message.author.id, info);
        }

        await safeDeleteMessage(message);
        await updateUserEphemeralReply(message.author.id, '✅ Analiza zakończona pomyślnie!');

        if (info && info.purpose === 'Przyszedłem w innym celu') {
            console.log(`[IMAGE_INPUT] Użytkownik ${message.author.username} przyszedł w innym celu - kończymy rekrutację`);
            await safeAddRole(message.member, config.roles.verified);
            await updateUserEphemeralReply(message.author.id, '✅ Proces rekrutacji zakończony pomyślnie! Witamy na serwerze!');
            
            await sendWelcomeMessageWithSummary(message.author);
            
            setTimeout(() => {
                userEphemeralReplies.delete(message.author.id);
            }, 5000);
            
            userStates.delete(message.author.id);
            return;
        }

        if (stats.characterAttack) {
            console.log(`[IMAGE_INPUT] Przystępuję do kwalifikacji klanu dla ${message.author.username} (atak: ${stats.characterAttack})`);
            
            const qualificationData = {
                member: message.member,
                attack: stats.characterAttack,
                user: message.author,
                stats: stats
            };
            
            if (stats.playerNick && stats.playerNick !== 'Nieznany') {
                await proposeNicknameChange(message.author, stats.playerNick, message.member, qualificationData);
            } else {
                await sendPendingQualification(message.author.id, qualificationData);
            }
        }

    } catch (error) {
        console.error(`[IMAGE_INPUT] ❌ Błąd podczas analizy obrazu:`, error);
        await safeDeleteMessage(message);
        
        await updateUserEphemeralReply(message.author.id, '❌ Wystąpił błąd podczas analizy obrazu. Spróbuj ponownie z innym zdjęciem.');
    }

    userStates.delete(message.author.id);
}

async function assignClanRole(member, attack, user) {
    console.log(`[CLAN_ASSIGN] Przypisywanie klanu dla ${user.username} z atakiem ${attack}`);
    
    await safeAddRole(member, config.roles.verified);

    let targetChannelId = null;

    if (attack < 100000) {
        console.log(`[CLAN_ASSIGN] Atak ${attack} - nie kwalifikuje się do żadnego klanu`);
        
        const welcomeChannel = client.channels.cache.get(config.channels.welcome);
        if (welcomeChannel) {
            await welcomeChannel.send(`${user}${config.messages.notQualified}`);
            await sendUserSummaryToWelcome(user, config.channels.welcome);
        }
    } else {
        await delay(1000);
        
        if (attack >= 100000 && attack <= 399999) {
            console.log(`[CLAN_ASSIGN] Przypisano do Clan0 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan0);
            targetChannelId = config.channels.clan0;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan0Welcome}`);
            }
        } else if (attack >= 400000 && attack <= 599999) {
            console.log(`[CLAN_ASSIGN] Przypisano do Clan1 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan1);
            targetChannelId = config.channels.clan1;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan1Welcome}`);
            }
        } else if (attack >= 600000 && attack <= 799999) {
            console.log(`[CLAN_ASSIGN] Przypisano do Clan2 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan2);
            targetChannelId = config.channels.clan2;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan2Welcome}`);
            }
        } else if (attack >= 800000) {
            console.log(`[CLAN_ASSIGN] Przypisano do MainClan (atak: ${attack})`);
            await safeAddRole(member, config.roles.mainClan);
            targetChannelId = config.channels.mainClan;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.mainClanWelcome}`);
            }
        }
    }

    console.log(`[CLAN_ASSIGN] ✅ Zakończono przypisywanie klanu dla ${user.username}`);
    return targetChannelId;
}

async function sendWelcomeMessageWithSummary(user) {
    console.log(`[WELCOME] Wysyłanie wiadomości powitalnej dla ${user.username}`);
    
    const welcomeChannel = client.channels.cache.get(config.channels.welcome);
    if (!welcomeChannel) {
        console.error(`[WELCOME] ❌ Nie znaleziono kanału powitalnego`);
        return;
    }

    try {
        await welcomeChannel.send(`${user} ${config.messages.generalWelcome}`);
        await sendUserSummaryToWelcome(user, config.channels.welcome);
        console.log(`[WELCOME] ✅ Wysłano wiadomość powitalną dla ${user.username}`);
    } catch (error) {
        console.error(`[WELCOME] ❌ Błąd podczas wysyłania wiadomości powitalnej:`, error);
    }
}

async function sendUserSummaryToWelcome(user, channelId) {
    console.log(`[SUMMARY] Wysyłanie podsumowania dla ${user.username} na kanał ${channelId}`);
    
    const info = userInfo.get(user.id);
    if (!info) {
        console.log(`[SUMMARY] ❌ Brak danych użytkownika ${user.username}`);
        return;
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        console.log(`[SUMMARY] ❌ Nie znaleziono kanału ${channelId}`);
        return;
    }

    let summaryText = '';
    
    summaryText += `<a:discord_logo:1389177319968473140> **Użytkownik Discord:** ${info.username}\n`;
    
    if (info.playerNick) {
        summaryText += `<:J_SurvivorJoey:1326511743555600451> **Nick w grze:** ${info.playerNick}\n`;
    }

    if (info.characterAttack !== null) {
        summaryText += `<:L_ATK:1209754263228522516> **Atak postaci:** ${info.characterAttack.toLocaleString()}\n`;
    }

    if (info.rcAmount !== null) {
        summaryText += `<:I_RC:1385139885924421653> **Ilość RC:** ${info.rcAmount}\n`;
    }

    if (info.lunarLevel !== null) {
        summaryText += `<:I_LVL:1389178270888759296> **Lunar Mine - Poziom:** ${info.lunarLevel}\n`;
    }

    if (info.lunarPoints !== null) {
        summaryText += `<:M_Medal:1209754405373747260> **Lunar Mine - Punkty I fazy:** ${info.lunarPoints.toLocaleString()}\n`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 Podsumowanie')
        .setDescription(summaryText)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Analiza zakończona' });

    const messageOptions = { embeds: [embed] };

    const userImagePath = userImages.get(user.id);
    if (userImagePath) {
        try {
            await fs.access(userImagePath);
            
            const attachment = new AttachmentBuilder(userImagePath, { 
                name: `stats_${user.id}.png`,
                description: 'Zdjęcie statystyk użytkownika'
            });
            
            messageOptions.files = [attachment];
            embed.setImage(`attachment://stats_${user.id}.png`);
            
            console.log(`[SUMMARY] ✅ Dołączono obraz do podsumowania`);
            
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się dołączyć obrazu`);
        }
    }

    await channel.send(messageOptions);
    console.log(`[SUMMARY] ✅ Wysłano podsumowanie dla ${user.username}`);
    
    userInfo.delete(user.id);
    
    if (userImagePath) {
        try {
            await fs.unlink(userImagePath);
            userImages.delete(user.id);
            console.log(`[SUMMARY] ✅ Usunięto tymczasowy obraz`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się usunąć tymczasowego obrazu`);
        }
    }
}

async function sendUserSummary(user, channelId) {
    console.log(`[SUMMARY] Wysyłanie podsumowania dla ${user.username} na kanał klanu ${channelId}`);
    
    const info = userInfo.get(user.id);
    if (!info) {
        console.log(`[SUMMARY] ❌ Brak danych użytkownika ${user.username}`);
        return;
    }

    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        console.log(`[SUMMARY] ❌ Nie znaleziono kanału ${channelId}`);
        return;
    }

    let summaryText = '';
    
    summaryText += `<a:discord_logo:1389177319968473140> **Użytkownik Discord:** ${info.username}\n`;
    
    if (info.playerNick) {
        summaryText += `<:J_SurvivorJoey:1326511743555600451> **Nick w grze:** ${info.playerNick}\n`;
    }

    if (info.characterAttack !== null) {
        summaryText += `<:L_ATK:1209754263228522516> **Atak postaci:** ${info.characterAttack.toLocaleString()}\n`;
    }

    if (info.rcAmount !== null) {
        summaryText += `<:I_RC:1385139885924421653> **Ilość RC:** ${info.rcAmount}\n`;
    }

    if (info.lunarLevel !== null) {
        summaryText += `<:I_LVL:1389178270888759296> **Lunar Mine - Poziom:** ${info.lunarLevel}\n`;
    }

    if (info.lunarPoints !== null) {
        summaryText += `<:M_Medal:1209754405373747260> **Lunar Mine - Punkty I fazy:** ${info.lunarPoints.toLocaleString()}\n`;
    }

    const embed = new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle('📊 Podsumowanie')
        .setDescription(summaryText)
        .setThumbnail(user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: 'Analiza zakończona' });

    const messageOptions = { embeds: [embed] };

    const userImagePath = userImages.get(user.id);
    if (userImagePath) {
        try {
            await fs.access(userImagePath);
            
            const attachment = new AttachmentBuilder(userImagePath, { 
                name: `stats_${user.id}.png`,
                description: 'Zdjęcie statystyk użytkownika'
            });
            
            messageOptions.files = [attachment];
            embed.setImage(`attachment://stats_${user.id}.png`);
            
            console.log(`[SUMMARY] ✅ Dołączono obraz do podsumowania klanu`);
            
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się dołączyć obrazu do podsumowania klanu`);
        }
    }

    await channel.send(messageOptions);
    console.log(`[SUMMARY] ✅ Wysłano podsumowanie klanu dla ${user.username}`);
    
    userInfo.delete(user.id);
    
    if (userImagePath) {
        try {
            await fs.unlink(userImagePath);
            userImages.delete(user.id);
            console.log(`[SUMMARY] ✅ Usunięto tymczasowy obraz po podsumowaniu klanu`);
        } catch (error) {
            console.log(`[SUMMARY] ❌ Nie udało się usunąć tymczasowego obrazu po podsumowaniu klanu`);
        }
    }
}

client.login(config.token);
