const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

class ClanRoleChangeService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.notificationChannelId = '1194396792981311489';

        // Specjalne role kierownicze
        this.leaderRole = '1196586785413795850';
        this.viceLeaderRole = '1196911721588199464';

        // Hierarchia klanów (od najwyższego do najniższego)
        this.clanHierarchy = {
            [config.roles.mainClan]: { level: 4, name: 'Main' },
            [config.roles.clan2]: { level: 3, name: '2' },
            [config.roles.clan1]: { level: 2, name: '1' },
            [config.roles.clan0]: { level: 1, name: '0' },
            [config.roles.verified]: { level: 0, name: 'Verified' }
        };
    }

    /**
     * Inicjalizuje serwis
     * @param {Client} client - Klient Discord
     */
    initialize(client) {
        this.client = client;
        logger.info('Serwis zmian ról klanowych został zainicjalizowany');
    }

    /**
     * Obsługuje zmianę ról członka
     * @param {GuildMember} oldMember - Stary stan członka
     * @param {GuildMember} newMember - Nowy stan członka
     */
    async handleRoleChange(oldMember, newMember) {
        try {
            // Debug log
            logger.info(`[CLAN_ROLE] Sprawdzanie zmian ról dla ${newMember.user.tag}`);

            // Pobierz stare i nowe role (ID)
            const oldRoleIds = Array.from(oldMember.roles.cache.keys());
            const newRoleIds = Array.from(newMember.roles.cache.keys());

            logger.info(`[CLAN_ROLE] Stare role: ${oldRoleIds.join(', ')}`);
            logger.info(`[CLAN_ROLE] Nowe role: ${newRoleIds.join(', ')}`);

            // Sprawdź czy użytkownik otrzymał rolę Lider
            if (!oldMember.roles.cache.has(this.leaderRole) && newMember.roles.cache.has(this.leaderRole)) {
                logger.info(`[CLAN_ROLE] Wykryto nadanie roli Lider dla ${newMember.user.tag}`);
                await this.sendLeadershipRoleNotification(newMember, 'AwansLider.png');
                return;
            }

            // Sprawdź czy użytkownik otrzymał rolę Vice Lider
            if (!oldMember.roles.cache.has(this.viceLeaderRole) && newMember.roles.cache.has(this.viceLeaderRole)) {
                logger.info(`[CLAN_ROLE] Wykryto nadanie roli Vice Lider dla ${newMember.user.tag}`);
                await this.sendLeadershipRoleNotification(newMember, 'AwansViceLider.png');
                return;
            }

            const oldClanRole = this.getClanRole(oldMember.roles.cache);
            const newClanRole = this.getClanRole(newMember.roles.cache);

            logger.info(`[CLAN_ROLE] Porównanie ról klanowych: stara=${oldClanRole || 'brak'}, nowa=${newClanRole || 'brak'}`);

            // Jeśli nie ma zmiany roli klanowej, return
            if (oldClanRole === newClanRole) {
                logger.info(`[CLAN_ROLE] Brak zmiany roli klanowej dla ${newMember.user.tag}`);
                return;
            }

            logger.info(`[CLAN_ROLE] Wykryto zmianę roli klanowej dla ${newMember.user.tag}: ${oldClanRole || 'brak'} -> ${newClanRole || 'brak'}`);

            // Określ typ zmiany
            const changeType = this.determineChangeType(oldClanRole, newClanRole);

            logger.info(`[CLAN_ROLE] Typ zmiany: ${changeType}`);

            if (changeType) {
                await this.sendRoleChangeNotification(newMember, changeType, newClanRole);
            } else {
                logger.info(`[CLAN_ROLE] Nie określono typu zmiany - pomijam`);
            }
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd podczas obsługi zmiany roli:`, error);
            logger.error(`[CLAN_ROLE] ❌ Stack trace:`, error.stack);
        }
    }

    /**
     * Pobiera najwyższą rolę klanową użytkownika
     * @param {Collection} roles - Kolekcja ról użytkownika
     * @returns {string|null} - ID roli klanowej lub null
     */
    getClanRole(roles) {
        const clanRoleIds = [
            this.config.roles.mainClan,
            this.config.roles.clan2,
            this.config.roles.clan1,
            this.config.roles.clan0
        ];

        // Znajdź najwyższą rolę klanową (według hierarchii)
        for (const roleId of clanRoleIds) {
            if (roles.has(roleId)) {
                return roleId;
            }
        }

        // Jeśli nie ma żadnej roli klanowej, sprawdź czy ma verified
        if (roles.has(this.config.roles.verified)) {
            return this.config.roles.verified;
        }

        return null;
    }

    /**
     * Określa typ zmiany (dołączenie, awans, degradacja)
     * @param {string|null} oldRole - Stara rola
     * @param {string|null} newRole - Nowa rola
     * @returns {string|null} - Typ zmiany: 'join', 'promotion', 'demotion' lub null
     */
    determineChangeType(oldRole, newRole) {
        // Jeśli nie było roli klanowej (tylko verified lub null), to dołączenie
        if (!oldRole || oldRole === this.config.roles.verified) {
            return 'join';
        }

        const oldLevel = this.clanHierarchy[oldRole]?.level || 0;
        const newLevel = this.clanHierarchy[newRole]?.level || 0;

        if (newLevel > oldLevel) {
            return 'promotion';
        } else if (newLevel < oldLevel) {
            return 'demotion';
        }

        return null;
    }

    /**
     * Wysyła powiadomienie o otrzymaniu roli kierowniczej (Lider/Vice Lider)
     * @param {GuildMember} member - Członek
     * @param {string} bannerFileName - Nazwa pliku banera
     */
    async sendLeadershipRoleNotification(member, bannerFileName) {
        try {
            const channel = await this.client.channels.fetch(this.notificationChannelId);
            if (!channel) {
                logger.error(`[CLAN_ROLE] ❌ Nie znaleziono kanału powiadomień (${this.notificationChannelId})`);
                return;
            }

            const bannerPath = path.join(__dirname, '../files', bannerFileName);

            logger.info(`[CLAN_ROLE] Próba wysłania banera kierowniczego: ${bannerFileName}`);

            const attachment = new AttachmentBuilder(bannerPath, {
                name: bannerFileName
            });

            await channel.send({
                content: `${member} powodzenia w pełnieniu nowej funkcji!`,
                files: [attachment]
            });

            logger.info(`[CLAN_ROLE] ✅ Wysłano powiadomienie o roli kierowniczej dla ${member.user.tag}`);
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd wysyłania powiadomienia o roli kierowniczej:`, error);
        }
    }

    /**
     * Wysyła powiadomienie o zmianie roli
     * @param {GuildMember} member - Członek
     * @param {string} changeType - Typ zmiany: 'join', 'promotion', 'demotion'
     * @param {string} newRole - Nowa rola klanowa
     */
    async sendRoleChangeNotification(member, changeType, newRole) {
        try {
            const channel = await this.client.channels.fetch(this.notificationChannelId);
            if (!channel) {
                logger.error(`[CLAN_ROLE] ❌ Nie znaleziono kanału powiadomień (${this.notificationChannelId})`);
                return;
            }

            const clanName = this.clanHierarchy[newRole]?.name || 'Unknown';
            const bannerFileName = this.getBannerFileName(changeType, clanName);
            const bannerPath = path.join(__dirname, '../files', bannerFileName);

            logger.info(`[CLAN_ROLE] Próba wysłania banera: ${bannerFileName}`);

            const attachment = new AttachmentBuilder(bannerPath, {
                name: bannerFileName
            });

            await channel.send({
                content: `${member} zaszły zmiany!`,
                files: [attachment]
            });

            logger.info(`[CLAN_ROLE] ✅ Wysłano powiadomienie o zmianie roli dla ${member.user.tag}`);
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd wysyłania powiadomienia:`, error);
        }
    }

    /**
     * Pobiera nazwę pliku banera
     * @param {string} changeType - Typ zmiany: 'join', 'promotion', 'demotion'
     * @param {string} clanName - Nazwa klanu: 'Main', '2', '1', '0'
     * @returns {string} - Nazwa pliku banera
     */
    getBannerFileName(changeType, clanName) {
        const typeMap = {
            'join': 'Dołączenie',
            'promotion': 'Awans',
            'demotion': 'Degradacja'
        };

        const prefix = typeMap[changeType] || 'Dołączenie';
        return `${prefix}${clanName}.png`;
    }
}

module.exports = ClanRoleChangeService;
