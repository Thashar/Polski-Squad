const { delay } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

async function safeAddRole(member, roleId) {
    try {
        logger.info(`[ROLE] Próba nadania roli ${roleId} użytkownikowi ${member.user.username}`);
        const role = member.guild.roles.cache.get(roleId);
        if (role) {
            await member.roles.add(role);
            logger.info(`[ROLE] ✅ Pomyślnie nadano rolę ${roleId} użytkownikowi ${member.user.username}`);
        } else {
            logger.info(`[ROLE] ❌ Rola ${roleId} nie została znaleziona`);
        }
    } catch (error) {
        logger.error(`[ROLE] ❌ Błąd podczas nadawania roli ${roleId}:`, error);
    }
}

async function assignClanRole(member, attack, user, config, client) {
    logger.info(`[CLAN_ASSIGN] Przypisywanie klanu dla ${user.username} z atakiem ${attack}`);
    await safeAddRole(member, config.roles.verified);
    let targetChannelId = null;

    // Wiadomość dla niezakwalifikowanych - pozostawiona w kodzie, ale nigdy nie wywoływana
    if (false && attack < 0) {
        logger.info(`[CLAN_ASSIGN] Atak ${attack} - nie kwalifikuje się do żadnego klanu`);
        const welcomeChannel = client.channels.cache.get(config.channels.welcome);
        if (welcomeChannel) {
            await welcomeChannel.send(`${user}${config.messages.notQualified}`);
        }
        targetChannelId = config.channels.welcome;
    } else {
        await delay(1000);

        if (attack >= 1500000) {
            logger.info(`[CLAN_ASSIGN] Przypisano do MainClan (atak: ${attack})`);
            await safeAddRole(member, config.roles.mainClan);
            targetChannelId = config.channels.mainClan;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.mainClanWelcome}`);
            }
        } else if (attack >= 1000000) {
            logger.info(`[CLAN_ASSIGN] Przypisano do Clan2 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan2);
            targetChannelId = config.channels.clan2;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan2Welcome}`);
            }
        } else if (attack >= 500000) {
            logger.info(`[CLAN_ASSIGN] Przypisano do Clan1 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan1);
            targetChannelId = config.channels.clan1;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan1Welcome}`);
            }
        } else {
            logger.info(`[CLAN_ASSIGN] Przypisano do Clan0 (atak: ${attack})`);
            await safeAddRole(member, config.roles.clan0);
            targetChannelId = config.channels.clan0;
            const channel = client.channels.cache.get(targetChannelId);
            if (channel) {
                await channel.send(`# ${user}\n${config.messages.clan0Welcome}`);
            }
        }
    }

    logger.info(`[CLAN_ASSIGN] ✅ Zakończono przypisywanie klanu dla ${user.username}`);
    return targetChannelId;
}

module.exports = {
    safeAddRole,
    assignClanRole
};
