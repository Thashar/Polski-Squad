const { AttachmentBuilder } = require('discord.js');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

class ClanRoleChangeService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.notificationChannelId = config.channels.welcome;

        // Specjalne role kierownicze
        this.leaderRole = config.roles.leader;
        this.viceLeaderRole = config.roles.viceLeader;
        this.viceLeaderMainRole = config.roles.viceLeaderMain;

        // Hierarchia klanów (od najwyższego do najniższego)
        this.clanHierarchy = {
            [config.roles.mainClan]: { level: 4, name: 'Main' },
            [config.roles.clan2]: { level: 3, name: '2' },
            [config.roles.clan1]: { level: 2, name: '1' },
            [config.roles.clan0]: { level: 1, name: '0' },
            [config.roles.verified]: { level: 0, name: 'Verified' }
        };

        // Cache ról użytkowników (userId -> roleIds[])
        // Używamy własnego cache, ponieważ oldMember.roles może być już zaktualizowany
        this.memberRolesCache = new Map();
    }

    /**
     * Inicjalizuje serwis
     * @param {Client} client - Klient Discord
     */
    async initialize(client) {
        this.client = client;
        await this.buildInitialCache();
        logger.info(`[CLAN_ROLE] Serwis zmian ról klanowych zainicjalizowany - ${this.memberRolesCache.size} członków w cache`);
    }

    /**
     * Buduje początkowy cache ról wszystkich członków
     */
    async buildInitialCache() {
        try {
            for (const guild of this.client.guilds.cache.values()) {
                const members = await guild.members.fetch({ limit: 1000 });

                for (const member of members.values()) {
                    const roleIds = Array.from(member.roles.cache.keys());
                    this.memberRolesCache.set(member.user.id, roleIds);
                }
            }
        } catch (error) {
            logger.error('[CLAN_ROLE] ❌ Błąd budowania cache:', error);
        }
    }

    /**
     * Obsługuje zmianę ról członka
     * @param {GuildMember} oldMember - Stary stan członka
     * @param {GuildMember} newMember - Nowy stan członka
     */
    async handleRoleChange(oldMember, newMember) {
        try {
            const userId = newMember.user.id;
            const previousRoleIds = this.memberRolesCache.get(userId) || [];

            // Pobierz aktualne role
            let freshMember;
            try {
                freshMember = await newMember.guild.members.fetch(userId);
            } catch (fetchError) {
                freshMember = newMember;
            }
            const currentRoleIds = Array.from(freshMember.roles.cache.keys());
            this.memberRolesCache.set(userId, currentRoleIds);

            // Sprawdź czy użytkownik otrzymał rolę Lider (Clan2/1/0)
            const hadLeaderRole = previousRoleIds.includes(this.leaderRole);
            const hasLeaderRole = currentRoleIds.includes(this.leaderRole);

            if (!hadLeaderRole && hasLeaderRole) {
                await this.sendLeadershipRoleNotification(freshMember, 'AwansLider.png', 'Lider');
                return;
            }

            // Sprawdź czy użytkownik otrzymał rolę Vice Lider Main
            const hadViceLeaderMainRole = previousRoleIds.includes(this.viceLeaderMainRole);
            const hasViceLeaderMainRole = currentRoleIds.includes(this.viceLeaderMainRole);

            if (!hadViceLeaderMainRole && hasViceLeaderMainRole) {
                await this.sendLeadershipRoleNotification(freshMember, 'AwansViceLiderMain.png', 'Vice Lider Main');
                return;
            }

            // Sprawdź czy użytkownik otrzymał rolę Vice Lider (Clan2/1/0)
            const hadViceLeaderRole = previousRoleIds.includes(this.viceLeaderRole);
            const hasViceLeaderRole = currentRoleIds.includes(this.viceLeaderRole);

            if (!hadViceLeaderRole && hasViceLeaderRole) {
                await this.sendLeadershipRoleNotification(freshMember, 'AwansViceLider.png', 'Vice Lider');
                return;
            }

            // Sprawdź zmiany ról klanowych
            const oldClanRole = this.getClanRoleFromIds(previousRoleIds);
            const newClanRole = this.getClanRoleFromIds(currentRoleIds);

            if (oldClanRole === newClanRole) {
                return;
            }

            // Określ typ zmiany
            const changeType = this.determineChangeType(oldClanRole, newClanRole);

            if (changeType) {
                await this.sendRoleChangeNotification(freshMember, changeType, newClanRole);
            }
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd podczas obsługi zmiany roli:`, error);
        }
    }

    /**
     * Pobiera najwyższą rolę klanową użytkownika z tablicy ID ról
     * @param {Array<string>} roleIds - Tablica ID ról użytkownika
     * @returns {string|null} - ID roli klanowej lub null
     */
    getClanRoleFromIds(roleIds) {
        const clanRoleIds = [
            this.config.roles.mainClan,
            this.config.roles.clan2,
            this.config.roles.clan1,
            this.config.roles.clan0
        ];

        // Znajdź najwyższą rolę klanową (według hierarchii)
        for (const roleId of clanRoleIds) {
            if (roleIds.includes(roleId)) {
                return roleId;
            }
        }

        // Jeśli nie ma żadnej roli klanowej, sprawdź czy ma verified
        if (roleIds.includes(this.config.roles.verified)) {
            return this.config.roles.verified;
        }

        return null;
    }

    /**
     * Pobiera najwyższą rolę klanową użytkownika
     * @param {Collection} roles - Kolekcja ról użytkownika
     * @returns {string|null} - ID roli klanowej lub null
     */
    getClanRole(roles) {
        const roleIds = Array.from(roles.keys());
        return this.getClanRoleFromIds(roleIds);
    }

    /**
     * Określa typ zmiany (dołączenie, awans, degradacja)
     * @param {string|null} oldRole - Stara rola
     * @param {string|null} newRole - Nowa rola
     * @returns {string|null} - Typ zmiany: 'join', 'promotion', 'demotion' lub null
     */
    determineChangeType(oldRole, newRole) {
        // Nie wysyłaj powiadomień dla roli Verified (tylko dla ról klanowych)
        if (!newRole || newRole === this.config.roles.verified) {
            return null;
        }

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
     * @param {string} roleName - Nazwa roli (Lider/Vice Lider)
     */
    async sendLeadershipRoleNotification(member, bannerFileName, roleName) {
        try {
            const channel = await this.client.channels.fetch(this.notificationChannelId);
            if (!channel) {
                logger.error(`[CLAN_ROLE] ❌ Nie znaleziono kanału powiadomień`);
                return;
            }

            const bannerPath = path.join(__dirname, '../files', bannerFileName);
            const attachment = new AttachmentBuilder(bannerPath, {
                name: bannerFileName
            });

            await channel.send({
                content: `${member} powodzenia w pełnieniu nowej funkcji!`,
                files: [attachment]
            });

            logger.info(`[CLAN_ROLE] ${member.user.tag} awansował na ${roleName}`);
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd wysyłania powiadomienia:`, error);
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
                logger.error(`[CLAN_ROLE] ❌ Nie znaleziono kanału powiadomień`);
                return;
            }

            const clanName = this.clanHierarchy[newRole]?.name || 'Unknown';
            const bannerFileName = this.getBannerFileName(changeType, clanName);
            const bannerPath = path.join(__dirname, '../files', bannerFileName);

            const attachment = new AttachmentBuilder(bannerPath, {
                name: bannerFileName
            });

            // Mapowanie ról klanowych do informacji o aplikacji
            const clanInfo = {
                [this.config.roles.mainClan]: 'Aplikuj do: Polski Squad ID: 42578',
                [this.config.roles.clan2]: 'Aplikuj do: PolskiSquad² ID: 202226',
                [this.config.roles.clan1]: 'Aplikuj do: PolskiSquad¹ ID: 125634',
                [this.config.roles.clan0]: 'Aplikuj do: PolskiSquad⁰ ID: 11616'
            };

            const clanApplicationInfo = clanInfo[newRole] || '';
            const message = clanApplicationInfo
                ? `${member} zmieniasz klan!\n${clanApplicationInfo}`
                : `${member} zmieniasz klan!`;

            await channel.send({
                content: message,
                files: [attachment]
            });

            // Log informacji o zmianie
            const changeTypeText = {
                'join': 'dołączył do',
                'promotion': 'awansował do',
                'demotion': 'przeszedł do'
            };
            const clanFullName = {
                'Main': 'Polski Squad',
                '2': 'PolskiSquad²',
                '1': 'PolskiSquad¹',
                '0': 'PolskiSquad⁰'
            };

            logger.info(`[CLAN_ROLE] ${member.user.tag} ${changeTypeText[changeType]} ${clanFullName[clanName]}`);
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
