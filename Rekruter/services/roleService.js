const { delay } = require('../utils/helpers');

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

async function assignClanRole(member, attack, user, config, client) {
    console.log(`[CLAN_ASSIGN] Przypisywanie klanu dla ${user.username} z atakiem ${attack}`);
    await safeAddRole(member, config.roles.verified);
    let targetChannelId = null;
    
    if (attack < 100000) {
        console.log(`[CLAN_ASSIGN] Atak ${attack} - nie kwalifikuje się do żadnego klanu`);
        const welcomeChannel = client.channels.cache.get(config.channels.welcome);
        if (welcomeChannel) {
            await welcomeChannel.send(`${user}${config.messages.notQualified}`);
        }
        // Ustawiam targetChannelId na kanał welcome dla niekwalifikujących się
        targetChannelId = config.channels.welcome;
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

module.exports = {
    safeAddRole,
    assignClanRole
};
