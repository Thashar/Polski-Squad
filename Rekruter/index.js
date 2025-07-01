const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Tesseract = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const sharp = require('sharp');

// Załadowanie zmiennych środowiskowych z folderu Rekruter
require('dotenv').config({ path: path.join(__dirname, '.env') });

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
        invalidEquipmentImage: "❌ To nie jest zdjęcie postaci! Proszę wklej zdjęcie postaci bez obróbki. Musi być widoczny Twój nick w prawym górnym rogu, postać oraz EQ!",
        nickNotFound: "❌ Nie mogę odczytać Twojego nicku! Upewnij się, że nick w prawym górnym rogu jest wyraźnie widoczny i nie jest obcięty ani zamazany!",
        attackNotFound: "❌ Nie mogę odczytać wartości ATK! Upewnij się, że statystyki postaci są wyraźnie widoczne!",
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

// Mapy przechowujące dane użytkowników
const userStates = new Map();
const userInfo = new Map();
const nicknameRequests = new Map();
const userEphemeralReplies = new Map();
const pendingQualifications = new Map();
const userImages = new Map();
const fileTimeouts = new Map();

const MONITORED_CHANNEL_ID = config.channels.recruitment;

// Funkcje pomocnicze
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeDeleteTempFile(userId, logPrefix = 'TEMP') {
    const userImagePath = userImages.get(userId);
    if (userImagePath) {
        try {
            await fs.unlink(userImagePath);
            userImages.delete(userId);
            console.log(`[${logPrefix}] ✅ Usunięto tymczasowy obraz dla użytkownika ${userId}`);
            return true;
        } catch (error) {
            console.log(`[${logPrefix}] ❌ Nie udało się usunąć tymczasowego obrazu: ${error.message}`);
            return false;
        }
    }
    return true;
}

async function cleanupTempFolder() {
    try {
        const tempDir = path.join(__dirname, 'temp');
        const files = await fs.readdir(tempDir);
        
        for (const file of files) {
            if (file.startsWith('temp_') || file.startsWith('region_')) {
                const filePath = path.join(tempDir, file);
                try {
                    await fs.unlink(filePath);
                    console.log(`[CLEANUP] ✅ Usunięto stary plik tymczasowy: ${file}`);
                } catch (error) {
                    console.log(`[CLEANUP] ❌ Nie udało się usunąć pliku: ${file}`);
                }
            }
        }
    } catch (error) {
        console.log(`[CLEANUP] ❌ Błąd podczas czyszczenia folderu temp:`, error);
    }
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

// ========== FUNKCJE ANALIZY OBRAZU ==========

async function getImageDimensions(imagePath) {
    try {
        const metadata = await sharp(imagePath).metadata();
        return { width: metadata.width, height: metadata.height };
    } catch (error) {
        console.error(`[IMAGE] ❌ Błąd pobierania wymiarów obrazu:`, error);
        return null;
    }
}

async function extractRegionFromImage(imagePath, region, outputPath) {
    try {
        console.log(`[REGION] Wycinanie regionu ${region.name} z ${imagePath}`);
        
        await sharp(imagePath)
            .extract({
                left: region.left,
                top: region.top,
                width: region.width,
                height: region.height
            })
            .png()
            .toFile(outputPath);
            
        console.log(`[REGION] ✅ Wycięto region ${region.name} do ${outputPath}`);
        return true;
    } catch (error) {
        console.error(`[REGION] ❌ Błąd wycinania regionu ${region.name}:`, error);
        return false;
    }
}

async function preprocessRegionForOCR(inputPath, outputPath, type = 'default') {
    try {
        console.log(`[PREPROCESS] Przetwarzanie regionu ${type}: ${inputPath}`);
        
        let pipeline = sharp(inputPath);
        
        switch (type) {
            case 'nickname':
                pipeline = pipeline
                    .grayscale()
                    .normalize()
                    .sharpen({ sigma: 1.0 })
                    .linear(1.2, -(128 * 0.2))
                    .threshold(160);
                break;
                
            case 'attack':
                pipeline = pipeline
                    .grayscale()
                    .normalize()
                    .sharpen({ sigma: 1.2 })
                    .linear(2.0, -(128 * 1.0))
                    .threshold(160);
                break;
                
            case 'equipment':
                pipeline = pipeline
                    .grayscale()
                    .normalize()
                    .threshold(200);
                break;
                
            default:
                pipeline = pipeline
                    .grayscale()
                    .normalize()
                    .threshold(180);
        }
        
        await pipeline.png().toFile(outputPath);
        console.log(`[PREPROCESS] ✅ Przetworzono region ${type}`);
        return true;
    } catch (error) {
        console.error(`[PREPROCESS] ❌ Błąd przetwarzania regionu ${type}:`, error);
        return false;
    }
}

function calculateImageRegions(width, height) {
    console.log(`[REGIONS] Kalkulacja regionów dla obrazu ${width}x${height}`);
    
    const regions = {
        nickname: {
            name: 'nickname',
            left: Math.floor(width * 0.5),
            top: 0,
            width: Math.floor(width * 0.5),
            height: Math.floor(height * 0.2)
        },
        stats: {
            name: 'stats',
            left: Math.floor(width * 0.1),
            top: Math.floor(height * 0.2),
            width: Math.floor(width * 0.8),
            height: Math.floor(height * 0.4)
        },
        equipment: {
            name: 'equipment',
            left: 0,
            top: Math.floor(height * 0.8),
            width: width,
            height: Math.floor(height * 0.2)
        }
    };
    
    console.log(`[REGIONS] Regiony:`, regions);
    return regions;
}

async function performOCROnRegion(imagePath, region, ocrOptions = {}) {
    try {
        console.log(`[OCR] Rozpoznawanie tekstu w regionie ${region}: ${imagePath}`);
        
        const defaultOptions = {
            lang: 'pol+eng',
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzĄĆĘŁŃÓŚŹŻąćęłńóśźż|: +-%.,()/'
        };
        
        const finalOptions = { ...defaultOptions, ...ocrOptions };
        
        const { data: { text, confidence } } = await Tesseract.recognize(imagePath, finalOptions.lang, finalOptions);
        
        console.log(`[OCR] Region ${region} - Pewność: ${confidence}%`);
        console.log(`[OCR] Region ${region} - Tekst: "${text.substring(0, 100)}..."`);
        
        return { text: text.trim(), confidence };
    } catch (error) {
        console.error(`[OCR] ❌ Błąd OCR dla regionu ${region}:`, error);
        return { text: '', confidence: 0 };
    }
}

function extractNicknameFromText(text) {
    console.log(`[NICK_EXTRACT] ===== ZAAWANSOWANA ANALIZA NICKU =====`);
    console.log(`[NICK_EXTRACT] Pełny tekst do analizy:`);
    console.log(text);
    console.log(`[NICK_EXTRACT] ===============================`);
    
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // METODA 1: Szukaj wzorca "PL | nick" (najwyższa pewność)
    console.log(`[NICK_EXTRACT] METODA 1: Szukanie wzorca "PL | nick"`);
    for (const line of lines) {
        console.log(`[NICK_EXTRACT] Analizuję linię: "${line}"`);
        
        const plPatterns = [
            /PL\s*\|\s*([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ][a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_-]*)/i,
            /PL\s*\|\s*([a-zA-Z][a-zA-Z0-9_-]*)/i,
            /PL\|\s*([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ][a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ_-]*)/i
        ];
        
        for (const pattern of plPatterns) {
            const match = line.match(pattern);
            if (match && match[1]) {
                const nickname = match[1].trim();
                if (nickname.length >= 3 && nickname.length <= 20) {
                    console.log(`[NICK_EXTRACT] ✅ SUKCES METODA 1: Znaleziono nick "${nickname}" (wzorzec PL)`);
                    return { nickname, confidence: 95, method: 'PL_pattern' };
                }
            }
        }
    }
    
    // METODA 2: Szukaj po znaku "|" (bez PL)
    console.log(`[NICK_EXTRACT] METODA 2: Szukanie po znaku "|"`);
    for (const line of lines) {
        if (line.includes('|')) {
            console.log(`[NICK_EXTRACT] Znaleziono linię z "|": "${line}"`);
            const parts = line.split('|');
            if (parts.length >= 2) {
                const potentialNick = parts[1].trim();
                const cleanNick = potentialNick.split(/\s+/)[0];
                
                if (cleanNick.length >= 3 && cleanNick.length <= 20 && /^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(cleanNick)) {
                    console.log(`[NICK_EXTRACT] ✅ SUKCES METODA 2: Znaleziono nick "${cleanNick}" (po |)`);
                    return { nickname: cleanNick, confidence: 85, method: 'pipe_split' };
                }
            }
        }
    }
    
    // METODA 3: Szukaj samodzielnego nicku (bez prefiksów)
    console.log(`[NICK_EXTRACT] METODA 3: Szukanie samodzielnego nicku`);
    
    const excludeWords = [
        'level', 'lvl', 'lv', 'attack', 'atk', 'equipment', 'equip', 'clan', 'guild', 
        'player', 'hp', 'defense', 'def', 'power', 'score', 'points', 'exp', 'gold',
        'silver', 'bronze', 'diamond', 'platinum', 'master', 'legendary',
        'my', 'equipment', 'stats', 'character', 'profile', 'info'
    ];
    
    const maxLines = Math.min(3, lines.length);
    for (let i = 0; i < maxLines; i++) {
        const line = lines[i];
        console.log(`[NICK_EXTRACT] METODA 3 - Analizuję linię ${i + 1}: "${line}"`);
        
        const words = line.split(/\s+/);
        for (const word of words) {
            const cleanWord = word.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]/g, '');
            
            if (cleanWord.length >= 3 && cleanWord.length <= 20) {
                if (/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(cleanWord)) {
                    const isExcluded = excludeWords.some(excluded => 
                        cleanWord.toLowerCase().includes(excluded.toLowerCase())
                    );
                    
                    if (!isExcluded) {
                        if (!/^\d+$/.test(cleanWord)) {
                            console.log(`[NICK_EXTRACT] ✅ SUKCES METODA 3: Znaleziono potencjalny nick "${cleanWord}"`);
                            return { nickname: cleanWord, confidence: 75, method: 'standalone_word' };
                        }
                    } else {
                        console.log(`[NICK_EXTRACT] Wykluczono słowo "${cleanWord}" (słowo kluczowe gry)`);
                    }
                }
            }
        }
    }
    
    // METODA 4: Ostatnia szansa - najdłuższe alfanumeryczne słowo
    console.log(`[NICK_EXTRACT] METODA 4: Ostatnia szansa - najdłuższe słowo`);
    
    let bestCandidate = null;
    let bestLength = 0;
    
    for (const line of lines.slice(0, 5)) {
        const words = line.split(/\s+/);
        for (const word of words) {
            const cleanWord = word.replace(/[^a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]/g, '');
            
            if (cleanWord.length >= 4 && cleanWord.length <= 20 && cleanWord.length > bestLength) {
                if (/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(cleanWord) && !/^\d+$/.test(cleanWord)) {
                    const isExcluded = excludeWords.some(excluded => 
                        cleanWord.toLowerCase().includes(excluded.toLowerCase())
                    );
                    
                    if (!isExcluded) {
                        bestCandidate = cleanWord;
                        bestLength = cleanWord.length;
                    }
                }
            }
        }
    }
    
    if (bestCandidate) {
        console.log(`[NICK_EXTRACT] ⚠️ SUKCES METODA 4: Najlepszy kandydat "${bestCandidate}" (niska pewność)`);
        return { nickname: bestCandidate, confidence: 60, method: 'best_candidate' };
    }
    
    console.log(`[NICK_EXTRACT] ❌ BRAK WYNIKU: Nie znaleziono nicku żadną metodą`);
    return { nickname: null, confidence: 0, method: 'none' };
}

function extractAttackFromText(text) {
    console.log(`[ATK_EXTRACT] ===== ZAAWANSOWANA ANALIZA ATK =====`);
    console.log(`[ATK_EXTRACT] Tekst do analizy:`);
    console.log(text);
    console.log(`[ATK_EXTRACT] ==============================`);
    
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // METODA 1: Szukaj linii z "ATK" i liczbą (najwyższa pewność)
    console.log(`[ATK_EXTRACT] METODA 1: Szukanie linii z "ATK"`);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`[ATK_EXTRACT] Sprawdzam linię ${i + 1}: "${line}"`);
        
        if (line.toLowerCase().includes('atk')) {
            console.log(`[ATK_EXTRACT] ✅ Znaleziono linię z ATK: "${line}"`);
            
            const numbers = line.match(/\b\d+\b/g);
            if (numbers) {
                console.log(`[ATK_EXTRACT] Znalezione liczby w linii ATK:`, numbers);
                
                for (const numStr of numbers) {
                    const num = parseInt(numStr);
                    if (num >= 1000 && num <= 50000000) {
                        console.log(`[ATK_EXTRACT] ✅ SUKCES METODA 1: Znaleziono ATK ${num} w linii ATK`);
                        return { attack: num, confidence: 95, method: 'ATK_line' };
                    }
                }
            }
        }
    }
    
    // METODA 2: Szukaj we wszystkich liniach liczb w odpowiednim zakresie
    console.log(`[ATK_EXTRACT] METODA 2: Szukanie we wszystkich liniach`);
    const allNumbers = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        console.log(`[ATK_EXTRACT] Sprawdzam linię ${i + 1}: "${line}"`);
        
        const numbers = line.match(/\b\d+\b/g);
        if (numbers) {
            for (const numStr of numbers) {
                const num = parseInt(numStr);
                if (num >= 1000 && num <= 50000000) {
                    let confidence = 70;
                    
                    if (line.toLowerCase().includes('atk')) {
                        confidence = 90;
                    }
                    
                    if (line.toLowerCase().includes('hp')) {
                        confidence -= 20;
                    }
                    
                    allNumbers.push({ 
                        num, 
                        line: line, 
                        lineIndex: i,
                        confidence 
                    });
                }
            }
        }
    }
    
    console.log(`[ATK_EXTRACT] Wszystkie potencjalne ATK:`, allNumbers);
    
    if (allNumbers.length > 0) {
        allNumbers.sort((a, b) => {
            if (b.confidence !== a.confidence) {
                return b.confidence - a.confidence;
            }
            return b.num - a.num;
        });
        
        const best = allNumbers[0];
        console.log(`[ATK_EXTRACT] ✅ SUKCES METODA 2: Wybrano najbardziej prawdopodobny ATK: ${best.num} (pewność: ${best.confidence}%)`);
        return { attack: best.num, confidence: best.confidence, method: 'best_guess' };
    }
    
    console.log(`[ATK_EXTRACT] ❌ BRAK WYNIKU: Nie znaleziono ataku żadną metodą`);
    return { attack: null, confidence: 0, method: 'none' };
}

function checkEquipmentKeyword(text) {
    console.log(`[EQUIPMENT] ===== SPRAWDZANIE SŁOWA EQUIPMENT =====`);
    console.log(`[EQUIPMENT] Tekst do sprawdzenia:`);
    console.log(text.substring(0, 200) + "...");
    console.log(`[EQUIPMENT] ===============================`);
    
    const lowerText = text.toLowerCase();
    const keywords = ['equipment', 'equipement', 'equipmnt', 'equip'];
    
    for (const keyword of keywords) {
        if (lowerText.includes(keyword)) {
            console.log(`[EQUIPMENT] ✅ SUKCES: Znaleziono słowo kluczowe "${keyword}"`);
            return { found: true, keyword, confidence: 90 };
        }
    }
    
    console.log(`[EQUIPMENT] ❌ BRAK WYNIKU: Nie znaleziono słów kluczowych Equipment`);
    return { found: false, keyword: null, confidence: 0 };
}

async function extractOptimizedStatsFromImage(imagePath, userId) {
    try {
        console.log(`[ANALYSIS] ===== ROZPOCZĘCIE ZAAWANSOWANEJ ANALIZY =====`);
        console.log(`[ANALYSIS] Użytkownik: ${userId}`);
        console.log(`[ANALYSIS] Ścieżka obrazu: ${imagePath}`);
        
        await updateUserEphemeralReply(userId, '📐 Analizuję wymiary obrazu...');
        
        const dimensions = await getImageDimensions(imagePath);
        if (!dimensions) {
            throw new Error('Nie można pobrać wymiarów obrazu');
        }
        
        console.log(`[ANALYSIS] Wymiary obrazu: ${dimensions.width}x${dimensions.height}`);
        
        // USUNIĘTO SPRAWDZANIE PROPORCJI - zdjęcia mogą mieć różne rozmiary
        
        await updateUserEphemeralReply(userId, '✂️ Wycinam regiony obrazu...');
        
        const regions = calculateImageRegions(dimensions.width, dimensions.height);
        
        const tempDir = path.dirname(imagePath);
        const baseFilename = path.basename(imagePath, path.extname(imagePath));
        
        const regionPaths = {
            nickname: {
                original: path.join(tempDir, `${baseFilename}_nickname_orig.png`),
                processed: path.join(tempDir, `${baseFilename}_nickname_proc.png`)
            },
            stats: {
                original: path.join(tempDir, `${baseFilename}_stats_orig.png`),
                processed: path.join(tempDir, `${baseFilename}_stats_proc.png`)
            },
            equipment: {
                original: path.join(tempDir, `${baseFilename}_equipment_orig.png`),
                processed: path.join(tempDir, `${baseFilename}_equipment_proc.png`)
            }
        };
        
        const regionExtractions = await Promise.all([
            extractRegionFromImage(imagePath, regions.nickname, regionPaths.nickname.original),
            extractRegionFromImage(imagePath, regions.stats, regionPaths.stats.original),
            extractRegionFromImage(imagePath, regions.equipment, regionPaths.equipment.original)
        ]);
        
        if (!regionExtractions.every(Boolean)) {
            throw new Error('Nie udało się wyciąć wszystkich regionów');
        }
        
        await updateUserEphemeralReply(userId, '🔧 Przetwarzam regiony...');
        
        await Promise.all([
            preprocessRegionForOCR(regionPaths.nickname.original, regionPaths.nickname.processed, 'nickname'),
            preprocessRegionForOCR(regionPaths.stats.original, regionPaths.stats.processed, 'attack'),
            preprocessRegionForOCR(regionPaths.equipment.original, regionPaths.equipment.processed, 'equipment')
        ]);
        
        await updateUserEphemeralReply(userId, '🔍 Rozpoznaję tekst...');
        
        const [nicknameOCR, statsOCR, equipmentOCR] = await Promise.all([
            performOCROnRegion(regionPaths.nickname.processed, 'nickname'),
            performOCROnRegion(regionPaths.stats.processed, 'stats', {
                tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz: '
            }),
            performOCROnRegion(regionPaths.equipment.processed, 'equipment')
        ]);
        
        console.log(`[ANALYSIS] OCR Results:`);
        console.log(`[ANALYSIS] Nickname region confidence: ${nicknameOCR.confidence}%`);
        console.log(`[ANALYSIS] Stats region confidence: ${statsOCR.confidence}%`);
        console.log(`[ANALYSIS] Equipment region confidence: ${equipmentOCR.confidence}%`);
        
        await updateUserEphemeralReply(userId, '📊 Analizuję wyniki...');
        
        const equipmentCheck = checkEquipmentKeyword(equipmentOCR.text);
        const nicknameResult = extractNicknameFromText(nicknameOCR.text);
        const attackResult = extractAttackFromText(statsOCR.text);
        
        const cleanupPaths = [
            ...Object.values(regionPaths.nickname),
            ...Object.values(regionPaths.stats),
            ...Object.values(regionPaths.equipment)
        ];
        
        for (const filePath of cleanupPaths) {
            try {
                await fs.unlink(filePath);
            } catch (error) {
                // Ignoruj błędy usuwania
            }
        }
        
        if (!equipmentCheck.found) {
            console.log(`[ANALYSIS] ❌ Nie znaleziono słowa Equipment - to nie jest zdjęcie Equipment`);
            return {
                isValidEquipment: false,
                playerNick: null,
                characterAttack: null,
                confidence: 0,
                error: 'EQUIPMENT_KEYWORD_NOT_FOUND'
            };
        }
        
        if (!nicknameResult.nickname) {
            console.log(`[ANALYSIS] ❌ Nie znaleziono nicku w prawym górnym rogu`);
            return {
                isValidEquipment: true,
                playerNick: null,
                characterAttack: attackResult.attack,
                confidence: 0,
                error: 'NICKNAME_NOT_FOUND'
            };
        }
        
        if (!attackResult.attack) {
            console.log(`[ANALYSIS] ❌ Nie znaleziono wartości ATK`);
            return {
                isValidEquipment: true,
                playerNick: nicknameResult.nickname,
                characterAttack: null,
                confidence: 0,
                error: 'ATTACK_NOT_FOUND'
            };
        }
        
        const overallConfidence = Math.round(
            (nicknameResult.confidence + attackResult.confidence + equipmentCheck.confidence) / 3
        );
        
        const result = {
            isValidEquipment: true,
            playerNick: nicknameResult.nickname,
            characterAttack: attackResult.attack,
            confidence: overallConfidence,
            details: {
                nickname: nicknameResult,
                attack: attackResult,
                equipment: equipmentCheck
            }
        };
        
        console.log(`[ANALYSIS] ===== WYNIKI ANALIZY =====`);
        console.log(`[ANALYSIS] Nick gracza: ${result.playerNick} (pewność: ${nicknameResult.confidence}%)`);
        console.log(`[ANALYSIS] Atak postaci: ${result.characterAttack} (pewność: ${attackResult.confidence}%)`);
        console.log(`[ANALYSIS] Equipment: ${equipmentCheck.found} (pewność: ${equipmentCheck.confidence}%)`);
        console.log(`[ANALYSIS] Ogólna pewność: ${overallConfidence}%`);
        console.log(`[ANALYSIS] ============================`);
        
        return result;
        
    } catch (error) {
        console.error(`[ANALYSIS] ❌ Błąd podczas zaawansowanej analizy:`, error);
        throw error;
    }
}

// ========== EVENT HANDLERS ==========

client.once('ready', async () => {
    console.log(`[BOT] ✅ Bot zalogowany jako ${client.user.tag}`);
    console.log(`[BOT] Data uruchomienia: ${new Date().toLocaleString('pl-PL')}`);
    
    try {
        await fs.mkdir(path.join(__dirname, 'temp'), { recursive: true });
        console.log(`[BOT] ✅ Utworzono folder temp`);
        
        await cleanupTempFolder();
        
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

// ========== FUNKCJE OBSŁUGI ==========

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
        await updateUserEphemeralReply(message.author.id, '🚀 Rozpoczynam zaawansowaną analizę zdjęcia...');
        
        const tempImagePath = path.join(__dirname, 'temp', `temp_${Date.now()}_${message.author.id}.png`);
        console.log(`[IMAGE_INPUT] Ścieżka tymczasowa: ${tempImagePath}`);
        
        await updateUserEphemeralReply(message.author.id, '📥 Pobieranie obrazu...');
        await downloadImage(attachment.url, tempImagePath);

        userImages.set(message.author.id, tempImagePath);

        const timeoutId = setTimeout(async () => {
            console.log(`[TIMEOUT] Automatyczne usuwanie pliku dla użytkownika ${message.author.id}`);
            await safeDeleteTempFile(message.author.id, 'TIMEOUT');
            fileTimeouts.delete(message.author.id);
        }, 30 * 60 * 1000);

        fileTimeouts.set(message.author.id, timeoutId);

        const stats = await extractOptimizedStatsFromImage(tempImagePath, message.author.id);

        if (!stats || !stats.isValidEquipment) {
            console.log(`[IMAGE_INPUT] ❌ Obraz nie zawiera prawidłowych danych`);
            await safeDeleteMessage(message);
            
            await safeDeleteTempFile(message.author.id, 'ERROR');
            const timeoutId = fileTimeouts.get(message.author.id);
            if (timeoutId) {
                clearTimeout(timeoutId);
                fileTimeouts.delete(message.author.id);
            }
            
            if (stats && stats.error === 'NICKNAME_NOT_FOUND') {
                await updateUserEphemeralReply(message.author.id, config.messages.nickNotFound);
            } else if (stats && stats.error === 'ATTACK_NOT_FOUND') {
                await updateUserEphemeralReply(message.author.id, config.messages.attackNotFound);
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
    const timeoutId = fileTimeouts.get(user.id);
    if (timeoutId) {
        clearTimeout(timeoutId);
        fileTimeouts.delete(user.id);
        console.log(`[SUMMARY] ✅ Anulowano timeout dla użytkownika ${user.id}`);
    }

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
    
    await safeDeleteTempFile(user.id, 'SUMMARY');
}

async function sendUserSummary(user, channelId) {
    const timeoutId = fileTimeouts.get(user.id);
    if (timeoutId) {
        clearTimeout(timeoutId);
        fileTimeouts.delete(user.id);
        console.log(`[SUMMARY] ✅ Anulowano timeout dla użytkownika ${user.id}`);
    }

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
    
    await safeDeleteTempFile(user.id, 'SUMMARY');
}

// Logowanie bota
client.login(config.token);
