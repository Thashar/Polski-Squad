const { delay } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const { getClanThresholds } = require('./stalkerThresholdsService');

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

async function assignClanRole(member, lunarPoints, user, config, client, guildId) {
    logger.info(`[CLAN_ASSIGN] Przypisywanie klanu dla ${user.username} — lunarPoints: ${lunarPoints}`);
    await safeAddRole(member, config.roles.verified);
    await delay(100);

    const thresholds = await getClanThresholds(guildId);

    if (!thresholds) {
        logger.warn(`[CLAN_ASSIGN] ⚠️ Brak danych progów ze Stalkera (guildId: ${guildId}) — kieruję do Clan0`);
    } else {
        logger.info(`[CLAN_ASSIGN] Progi: ${JSON.stringify(thresholds)}`);
    }

    // Wyznacz najwyższy klan do którego kandydat się kwalifikuje
    // Porównanie: lunarPoints >= próg danego klanu (od najwyższego do najniższego)
    let targetClan = 'clan0';

    if (thresholds) {
        const tMain = thresholds['main'];
        const t2    = thresholds['2'];
        const t1    = thresholds['1'];

        if (tMain !== null && tMain !== undefined && lunarPoints >= tMain) {
            targetClan = 'main';
        } else if (t2 !== null && t2 !== undefined && lunarPoints >= t2) {
            targetClan = 'clan2';
        } else if (t1 !== null && t1 !== undefined && lunarPoints >= t1) {
            targetClan = 'clan1';
        }
    }

    let targetChannelId = null;

    if (targetClan === 'main') {
        logger.info(`[CLAN_ASSIGN] Przypisano rolę rekrutacyjną Main (lunarPoints: ${lunarPoints}, próg: ${thresholds['main']})`);
        await safeAddRole(member, config.recruitRoles.recruitMain);
        targetChannelId = config.channels.mainClan;
        const channel = client.channels.cache.get(targetChannelId);
        if (channel) await channel.send(`# ${user}\n${config.messages.mainClanWelcome}`);
    } else if (targetClan === 'clan2') {
        logger.info(`[CLAN_ASSIGN] Przypisano rolę rekrutacyjną Clan2 (lunarPoints: ${lunarPoints}, próg: ${thresholds['2']})`);
        await safeAddRole(member, config.recruitRoles.recruit2);
        targetChannelId = config.channels.clan2;
        const channel = client.channels.cache.get(targetChannelId);
        if (channel) await channel.send(`# ${user}\n${config.messages.clan2Welcome}`);
    } else if (targetClan === 'clan1') {
        logger.info(`[CLAN_ASSIGN] Przypisano rolę rekrutacyjną Clan1 (lunarPoints: ${lunarPoints}, próg: ${thresholds['1']})`);
        await safeAddRole(member, config.recruitRoles.recruit1);
        targetChannelId = config.channels.clan1;
        const channel = client.channels.cache.get(targetChannelId);
        if (channel) await channel.send(`# ${user}\n${config.messages.clan1Welcome}`);
    } else {
        logger.info(`[CLAN_ASSIGN] Przypisano rolę rekrutacyjną Clan0 (lunarPoints: ${lunarPoints})`);
        await safeAddRole(member, config.recruitRoles.recruit0);
        targetChannelId = config.channels.clan0;
        const channel = client.channels.cache.get(targetChannelId);
        if (channel) await channel.send(`# ${user}\n${config.messages.clan0Welcome}`);
    }

    logger.info(`[CLAN_ASSIGN] ✅ Zakończono przypisywanie klanu dla ${user.username}`);
    return targetChannelId;
}

module.exports = {
    safeAddRole,
    assignClanRole
};
