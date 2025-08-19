const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class RoleChangeLogService {
    constructor(config) {
        this.config = config;
        this.roleChanges = new Map(); // roleId -> { role, added: [], removed: [], timeout }
        this.userChanges = new Map(); // userId -> { member, added: [], removed: [], timeout }
        this.processedAuditLogs = new Set(); // ID audit logs które już przetworzyliśmy
        this.logChannelId = '1407485227927998545';
    }

    /**
     * Inicjalizuje serwis
     * @param {Client} client - Klient Discord
     */
    initialize(client) {
        this.client = client;
        logger.info('Serwis logowania zmian ról został zainicjalizowany');
    }

    /**
     * Loguje zmianę roli użytkownika na podstawie audit logs
     * @param {GuildMember} oldMember - Stary stan członka
     * @param {GuildMember} newMember - Nowy stan członka
     */
    async logRoleChange(oldMember, newMember) {
        if (!this.client) return;

        // Sprawdź audit logs aby znaleźć rzeczywiste zmiany ról
        await this.checkAuditLogsForRoleChanges(newMember.guild);
    }

    /**
     * Sprawdza audit logs w poszukiwaniu zmian ról
     * @param {Guild} guild - Serwer Discord
     */
    async checkAuditLogsForRoleChanges(guild) {
        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: 25, // MEMBER_ROLE_UPDATE
                limit: 50
            });

            for (const auditEntry of auditLogs.entries.values()) {
                const timeDiff = Date.now() - auditEntry.createdTimestamp;
                
                // Sprawdź tylko ostatnie 30 sekund aby uniknąć duplikatów
                if (timeDiff > 30000) continue;

                // Sprawdź czy już przetworzyliśmy ten audit log
                if (this.processedAuditLogs && this.processedAuditLogs.has(auditEntry.id)) {
                    continue;
                }

                await this.processRoleAuditEntry(auditEntry);
                
                // Oznacz jako przetworzone
                if (!this.processedAuditLogs) {
                    this.processedAuditLogs = new Set();
                }
                this.processedAuditLogs.add(auditEntry.id);
            }
        } catch (error) {
            logger.error(`Błąd sprawdzania audit logs ról: ${error.message}`);
        }
    }

    /**
     * Przetwarza pojedynczy wpis audit log dotyczący zmian ról
     * @param {GuildAuditLogsEntry} auditEntry - Wpis z audit logs
     */
    async processRoleAuditEntry(auditEntry) {
        const { executor, target, changes } = auditEntry;
        
        if (!changes || !target) return;

        // Znajdź zmiany ról
        const roleChanges = changes.filter(change => change.key === '$add' || change.key === '$remove');
        
        for (const change of roleChanges) {
            const isAdded = change.key === '$add';
            const roles = change.new || change.old;
            
            if (!roles || !Array.isArray(roles)) continue;

            for (const roleData of roles) {
                try {
                    const role = await auditEntry.guild.roles.fetch(roleData.id);
                    const member = await auditEntry.guild.members.fetch(target.id);
                    
                    if (role && member) {
                        await this.trackRoleChange(role, member, isAdded ? 'added' : 'removed');
                    }
                } catch (error) {
                    // Ignoruj błędy pobierania ról/członków
                }
            }
        }
    }

    /**
     * Śledzi zmiany roli i grupuje je
     * @param {Role} role - Rola
     * @param {GuildMember} member - Członek serwera
     * @param {string} action - 'added' lub 'removed'
     */
    async trackRoleChange(role, member, action) {
        const roleId = role.id;

        // Pobierz lub utwórz tracking dla tej roli
        if (!this.roleChanges.has(roleId)) {
            this.roleChanges.set(roleId, {
                role: role,
                added: [],
                removed: [],
                timeout: null
            });
        }

        const roleData = this.roleChanges.get(roleId);

        // Dodaj użytkownika do odpowiedniej listy
        if (action === 'added') {
            roleData.added.push(member);
        } else {
            roleData.removed.push(member);
        }

        // Anuluj poprzedni timeout jeśli istnieje
        if (roleData.timeout) {
            clearTimeout(roleData.timeout);
        }

        // Ustaw nowy timeout na 10 sekund (dla testów)
        roleData.timeout = setTimeout(async () => {
            await this.sendRoleChangeEmbed(roleId);
        }, 10000); // 10 sekund
    }

    /**
     * Wysyła embed ze zmianami ról
     * @param {string} roleId - ID roli
     */
    async sendRoleChangeEmbed(roleId) {
        const roleData = this.roleChanges.get(roleId);
        if (!roleData) return;

        const { role, added, removed } = roleData;
        
        // Sprawdź czy są jakieś zmiany
        if (added.length === 0 && removed.length === 0) {
            this.roleChanges.delete(roleId);
            return;
        }

        try {
            const logChannel = await this.client.channels.fetch(this.logChannelId);
            if (!logChannel) {
                logger.warn(`Nie znaleziono kanału logowania ról: ${this.logChannelId}`);
                this.roleChanges.delete(roleId);
                return;
            }

            // Określ kolor na podstawie działań
            let color = 0x808080; // Szary domyślny
            let title = `🔄 Zmiany roli: ${role.name}`;

            if (added.length > 0 && removed.length === 0) {
                color = 0x00FF00; // Zielony - tylko dodawanie
                title = `✅ Dodano rolę: ${role.name}`;
            } else if (removed.length > 0 && added.length === 0) {
                color = 0xFF0000; // Czerwony - tylko usuwanie
                title = `❌ Usunięto rolę: ${role.name}`;
            }

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color)
                .setTimestamp();

            // Dodaj ikonę roli jeśli istnieje
            if (role.iconURL()) {
                embed.setThumbnail(role.iconURL());
            }

            // Dodaj listę użytkowników, którym dodano rolę
            if (added.length > 0) {
                const addedList = added
                    .map(member => `${member.displayName} (${member.user.tag})`)
                    .join('\n');
                
                embed.addFields({
                    name: `👤 ${added.length} ${added.length === 1 ? 'użytkownik' : 'użytkowników'}\n`,
                    value: addedList.length > 1024 ? addedList.substring(0, 1021) + '...' : addedList,
                    inline: false
                });
            }

            // Dodaj listę użytkowników, którym usunięto rolę
            if (removed.length > 0) {
                const removedList = removed
                    .map(member => `${member.displayName} (${member.user.tag})`)
                    .join('\n');
                
                embed.addFields({
                    name: `👤 ${removed.length} ${removed.length === 1 ? 'użytkownik' : 'użytkowników'}\n`,
                    value: removedList.length > 1024 ? removedList.substring(0, 1021) + '...' : removedList,
                    inline: false
                });
            }

            await logChannel.send({ embeds: [embed] });
            
            logger.info(`📊 Wysłano zbiorczy log zmian dla roli ${role.name}: +${added.length} -${removed.length}`);

        } catch (error) {
            logger.error(`Błąd podczas wysyłania logu zmian ról: ${error.message}`);
        }

        // Usuń tracking dla tej roli
        this.roleChanges.delete(roleId);
    }

    /**
     * Śledzi zmiany ról dla pojedynczego użytkownika (gdy ma zarówno dodane jak i usunięte role)
     * @param {GuildMember} member - Członek serwera
     * @param {Collection} addedRoles - Dodane role
     * @param {Collection} removedRoles - Usunięte role
     */
    async trackUserRoleChanges(member, addedRoles, removedRoles) {
        const userId = member.id;

        // Pobierz lub utwórz tracking dla tego użytkownika
        if (!this.userChanges.has(userId)) {
            this.userChanges.set(userId, {
                member: member,
                added: [],
                removed: [],
                timeout: null
            });
        }

        const userData = this.userChanges.get(userId);

        // Dodaj role do odpowiednich list
        for (const [roleId, role] of addedRoles) {
            userData.added.push(role);
        }

        for (const [roleId, role] of removedRoles) {
            userData.removed.push(role);
        }

        // Anuluj poprzedni timeout jeśli istnieje
        if (userData.timeout) {
            clearTimeout(userData.timeout);
        }

        // Ustaw nowy timeout na 10 sekund (dla testów)
        userData.timeout = setTimeout(async () => {
            await this.sendUserRoleChangeEmbed(userId);
        }, 10000); // 10 sekund
    }

    /**
     * Wysyła embed ze zmianami ról dla pojedynczego użytkownika
     * @param {string} userId - ID użytkownika
     */
    async sendUserRoleChangeEmbed(userId) {
        const userData = this.userChanges.get(userId);
        if (!userData) return;

        const { member, added, removed } = userData;
        
        // Sprawdź czy są jakieś zmiany
        if (added.length === 0 && removed.length === 0) {
            this.userChanges.delete(userId);
            return;
        }

        try {
            const logChannel = await this.client.channels.fetch(this.logChannelId);
            if (!logChannel) {
                logger.warn(`Nie znaleziono kanału logowania ról: ${this.logChannelId}`);
                this.userChanges.delete(userId);
                return;
            }

            // Określ kolor na podstawie działań
            let color = 0x808080; // Szary domyślny dla mieszanych zmian
            let title = `🔄 Zmiany ról użytkownika: ${member.displayName}`;

            const embed = new EmbedBuilder()
                .setTitle(title)
                .setColor(color)
                .setTimestamp()
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }));

            // Dodaj informacje o użytkowniku
            embed.addFields({
                name: '👤 Użytkownik',
                value: `**Nick na serwerze:** ${member.displayName}\n**Nick Discord:** ${member.user.tag}\n**ID:** ${member.id}`,
                inline: false
            });

            // Dodaj listę dodanych ról
            if (added.length > 0) {
                const addedList = added
                    .map(role => `<@&${role.id}> (${role.name})`)
                    .join('\n');
                
                embed.addFields({
                    name: `👤 ${added.length} ${added.length === 1 ? 'rola' : 'ról'}\n`,
                    value: addedList.length > 1024 ? addedList.substring(0, 1021) + '...' : addedList,
                    inline: false
                });
            }

            // Dodaj listę usuniętych ról
            if (removed.length > 0) {
                const removedList = removed
                    .map(role => `<@&${role.id}> (${role.name})`)
                    .join('\n');
                
                embed.addFields({
                    name: `👤 ${removed.length} ${removed.length === 1 ? 'rola' : 'ról'}\n`,
                    value: removedList.length > 1024 ? removedList.substring(0, 1021) + '...' : removedList,
                    inline: false
                });
            }

            await logChannel.send({ embeds: [embed] });
            
            logger.info(`👤 Wysłano log zmian ról dla użytkownika ${member.displayName}: +${added.length} -${removed.length}`);

        } catch (error) {
            logger.error(`Błąd podczas wysyłania logu zmian ról użytkownika: ${error.message}`);
        }

        // Usuń tracking dla tego użytkownika
        this.userChanges.delete(userId);
    }

    /**
     * Czyści wszystkie oczekujące timeouty (przy zamykaniu bota)
     */
    cleanup() {
        for (const [roleId, roleData] of this.roleChanges) {
            if (roleData.timeout) {
                clearTimeout(roleData.timeout);
            }
        }
        this.roleChanges.clear();

        for (const [userId, userData] of this.userChanges) {
            if (userData.timeout) {
                clearTimeout(userData.timeout);
            }
        }
        this.userChanges.clear();
        this.processedAuditLogs.clear();
        
        logger.info('Wyczyszczono wszystkie oczekujące logi zmian ról');
    }
}

module.exports = RoleChangeLogService;