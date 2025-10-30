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

        // Loguj ID ról klanowych z konfiguracji
        logger.info(`[CLAN_ROLE] ID ról klanowych z konfiguracji:`);
        logger.info(`[CLAN_ROLE]   - Main Clan: ${this.config.roles.mainClan}`);
        logger.info(`[CLAN_ROLE]   - Clan2: ${this.config.roles.clan2}`);
        logger.info(`[CLAN_ROLE]   - Clan1: ${this.config.roles.clan1}`);
        logger.info(`[CLAN_ROLE]   - Clan0: ${this.config.roles.clan0}`);
        logger.info(`[CLAN_ROLE]   - Verified: ${this.config.roles.verified}`);
        logger.info(`[CLAN_ROLE]   - Lider: ${this.leaderRole}`);
        logger.info(`[CLAN_ROLE]   - Vice Lider: ${this.viceLeaderRole}`);

        await this.buildInitialCache();
        logger.info(`[CLAN_ROLE] Serwis zmian ról klanowych został zainicjalizowany - ${this.memberRolesCache.size} członków w cache`);
    }

    /**
     * Buduje początkowy cache ról wszystkich członków
     */
    async buildInitialCache() {
        try {
            logger.info('[CLAN_ROLE] Budowanie cache ról członków...');
            let totalCached = 0;

            for (const guild of this.client.guilds.cache.values()) {
                const members = await guild.members.fetch({ limit: 1000 });

                for (const member of members.values()) {
                    const roleIds = Array.from(member.roles.cache.keys());
                    this.memberRolesCache.set(member.user.id, roleIds);
                    totalCached++;
                }
            }

            logger.info(`[CLAN_ROLE] Cache gotowy - ${totalCached} członków`);
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

            logger.info(`[CLAN_ROLE] ========== Sprawdzanie zmian dla ${newMember.user.tag} (${userId}) ==========`);

            // Pobierz POPRZEDNIE role z naszego cache (nie z oldMember!)
            const previousRoleIds = this.memberRolesCache.get(userId) || [];
            logger.info(`[CLAN_ROLE] Cache miał ${previousRoleIds.length} poprzednich ról`);

            // Pobierz AKTUALNE role z fresh member
            let freshMember;
            try {
                freshMember = await newMember.guild.members.fetch(userId);
                logger.info(`[CLAN_ROLE] Pobrano fresh member z API`);
            } catch (fetchError) {
                freshMember = newMember;
                logger.warn(`[CLAN_ROLE] Nie udało się pobrać fresh member, używam newMember: ${fetchError.message}`);
            }
            const currentRoleIds = Array.from(freshMember.roles.cache.keys());
            logger.info(`[CLAN_ROLE] Aktualne role: ${currentRoleIds.length} ról`);

            // Aktualizuj cache
            this.memberRolesCache.set(userId, currentRoleIds);
            logger.info(`[CLAN_ROLE] Cache zaktualizowany`);

            // Sprawdź czy były jakieś zmiany w ogóle
            const addedRoles = currentRoleIds.filter(id => !previousRoleIds.includes(id));
            const removedRoles = previousRoleIds.filter(id => !currentRoleIds.includes(id));
            logger.info(`[CLAN_ROLE] Dodane role: ${addedRoles.length}, Usunięte role: ${removedRoles.length}`);

            // Sprawdź czy użytkownik otrzymał rolę Lider
            const hadLeaderRole = previousRoleIds.includes(this.leaderRole);
            const hasLeaderRole = currentRoleIds.includes(this.leaderRole);

            if (!hadLeaderRole && hasLeaderRole) {
                logger.info(`[CLAN_ROLE] Wykryto nadanie roli Lider dla ${freshMember.user.tag}`);
                await this.sendLeadershipRoleNotification(freshMember, 'AwansLider.png');
                return;
            }

            // Sprawdź czy użytkownik otrzymał rolę Vice Lider
            const hadViceLeaderRole = previousRoleIds.includes(this.viceLeaderRole);
            const hasViceLeaderRole = currentRoleIds.includes(this.viceLeaderRole);

            if (!hadViceLeaderRole && hasViceLeaderRole) {
                logger.info(`[CLAN_ROLE] Wykryto nadanie roli Vice Lider dla ${freshMember.user.tag}`);
                await this.sendLeadershipRoleNotification(freshMember, 'AwansViceLider.png');
                return;
            }

            // Sprawdź zmiany ról klanowych
            logger.info(`[CLAN_ROLE] Sprawdzanie ról klanowych...`);
            const oldClanRole = this.getClanRoleFromIds(previousRoleIds);
            const newClanRole = this.getClanRoleFromIds(currentRoleIds);

            logger.info(`[CLAN_ROLE] Poprzednia rola klanowa: ${oldClanRole || 'BRAK'}`);
            logger.info(`[CLAN_ROLE] Aktualna rola klanowa: ${newClanRole || 'BRAK'}`);

            // Debug: Pokaż które role klanowe ma użytkownik
            const clanRoleIds = [
                this.config.roles.mainClan,
                this.config.roles.clan2,
                this.config.roles.clan1,
                this.config.roles.clan0,
                this.config.roles.verified
            ];
            const userClanRoles = currentRoleIds.filter(id => clanRoleIds.includes(id));
            logger.info(`[CLAN_ROLE] Użytkownik ma następujące role klanowe: ${userClanRoles.join(', ') || 'BRAK'}`);

            // Jeśli nie ma zmiany roli klanowej, return
            if (oldClanRole === newClanRole) {
                logger.info(`[CLAN_ROLE] Brak zmiany roli klanowej - koniec sprawdzania`);
                return;
            }

            logger.info(`[CLAN_ROLE] ✅ WYKRYTO ZMIANĘ ROLI KLANOWEJ!`);
            logger.info(`[CLAN_ROLE] ${oldClanRole || 'brak'} -> ${newClanRole || 'brak'}`);

            // Określ typ zmiany
            const changeType = this.determineChangeType(oldClanRole, newClanRole);
            logger.info(`[CLAN_ROLE] Określony typ zmiany: ${changeType || 'BRAK'}`);

            if (changeType) {
                logger.info(`[CLAN_ROLE] Wysyłanie powiadomienia...`);
                await this.sendRoleChangeNotification(freshMember, changeType, newClanRole);
            } else {
                logger.warn(`[CLAN_ROLE] Nie określono typu zmiany mimo wykrycia zmiany roli!`);
            }
        } catch (error) {
            logger.error(`[CLAN_ROLE] ❌ Błąd podczas obsługi zmiany roli:`, error);
            logger.error(`[CLAN_ROLE] ❌ Stack trace:`, error.stack);
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

        logger.info(`[CLAN_ROLE] getClanRoleFromIds: Sprawdzam ${roleIds.length} ról użytkownika`);
        logger.info(`[CLAN_ROLE] getClanRoleFromIds: Szukam w kolejności: MainClan, Clan2, Clan1, Clan0`);

        // Znajdź najwyższą rolę klanową (według hierarchii)
        for (const roleId of clanRoleIds) {
            logger.info(`[CLAN_ROLE] getClanRoleFromIds: Sprawdzam czy user ma rolę ${roleId}`);
            if (roleIds.includes(roleId)) {
                logger.info(`[CLAN_ROLE] getClanRoleFromIds: ✅ Znaleziono! Zwracam ${roleId}`);
                return roleId;
            }
        }

        logger.info(`[CLAN_ROLE] getClanRoleFromIds: Nie znaleziono ról klanowych, sprawdzam Verified`);

        // Jeśli nie ma żadnej roli klanowej, sprawdź czy ma verified
        if (roleIds.includes(this.config.roles.verified)) {
            logger.info(`[CLAN_ROLE] getClanRoleFromIds: ✅ Znaleziono Verified! Zwracam ${this.config.roles.verified}`);
            return this.config.roles.verified;
        }

        logger.info(`[CLAN_ROLE] getClanRoleFromIds: ❌ Nie znaleziono żadnej roli klanowej ani Verified - zwracam null`);
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
