const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class RoleChangeLogService {
    constructor(config) {
        this.config = config;
        this.logChannelId = '1407485227927998545';
        this.processedAuditLogs = new Set();
        this.auditCheckInterval = null;
    }

    /**
     * Inicjalizuje serwis
     * @param {Client} client - Klient Discord
     */
    async initialize(client) {
        this.client = client;
        
        // Testuj dostęp do kanału logowania
        try {
            const logChannel = await client.channels.fetch(this.logChannelId);
            if (logChannel) {
                logger.info(`✅ Znaleziono kanał logowania: ${logChannel.name} (${this.logChannelId})`);
            } else {
                logger.error(`❌ Nie znaleziono kanału logowania: ${this.logChannelId}`);
                return;
            }
        } catch (error) {
            logger.error(`❌ Błąd dostępu do kanału logowania: ${error.message}`);
            return;
        }
        
        // Uruchom sprawdzanie audit logs co 5 sekund (zwiększam dla testów)
        this.auditCheckInterval = setInterval(async () => {
            await this.checkAllGuildsForRoleChanges();
        }, 5000);
        
        logger.info('Serwis logowania zmian ról został zainicjalizowany (sprawdzanie co 5s)');
    }

    /**
     * Sprawdza wszystkie serwery dla zmian ról
     */
    async checkAllGuildsForRoleChanges() {
        if (!this.client || !this.client.guilds) {
            logger.warn('Brak client lub guilds');
            return;
        }

        for (const guild of this.client.guilds.cache.values()) {
            await this.checkGuildRoleChanges(guild);
        }
    }

    /**
     * Sprawdza audit logs serwera dla zmian ról
     * @param {Guild} guild - Serwer Discord
     */
    async checkGuildRoleChanges(guild) {
        try {
            const auditLogs = await guild.fetchAuditLogs({
                type: 25, // MEMBER_ROLE_UPDATE
                limit: 10
            });

            let newCount = 0;
            for (const auditEntry of auditLogs.entries.values()) {
                // Sprawdź czy już przetworzyliśmy ten audit log
                if (this.processedAuditLogs.has(auditEntry.id)) {
                    continue;
                }

                // Przetwórz nowy audit log
                await this.processRoleAuditEntry(auditEntry);
                this.processedAuditLogs.add(auditEntry.id);
                newCount++;
        } catch (error) {
            logger.error(`Błąd sprawdzania audit logs dla ${guild.name}: ${error.message}`);
        }
    }

    /**
     * Przetwarza wpis audit log dotyczący zmian ról
     * @param {GuildAuditLogsEntry} auditEntry - Wpis z audit logs
     */
    async processRoleAuditEntry(auditEntry) {
        const { executor, target, changes } = auditEntry;
        
        if (!changes || !target) {
            logger.info(`❌ Brak changes (${!!changes}) lub target (${!!target})`);
            return;
        }

        try {
            const member = await auditEntry.guild.members.fetch(target.id);
            if (!member) {
                logger.info(`❌ Nie można pobrać member dla ${target.tag}`);
                return;
            }

            const addedRoles = [];
            const removedRoles = [];

            logger.info(`🔍 Sprawdzam ${changes.length} zmian dla ${member.displayName}`);

            // Przetwórz zmiany ról
            for (const change of changes) {
                logger.info(`📋 Change: key=${change.key}, new=${!!change.new}, old=${!!change.old}`);
                
                if (change.key === '$add' && change.new) {
                    for (const roleData of change.new) {
                        try {
                            const role = await auditEntry.guild.roles.fetch(roleData.id);
                            if (role) {
                                addedRoles.push(role);
                                logger.info(`➕ Dodano rolę: ${role.name}`);
                            }
                        } catch (error) {
                            // Ignoruj błędy pobierania ról
                        }
                    }
                } else if (change.key === '$remove' && change.old) {
                    for (const roleData of change.old) {
                        try {
                            const role = await auditEntry.guild.roles.fetch(roleData.id);
                            if (role) {
                                removedRoles.push(role);
                                logger.info(`➖ Usunięto rolę: ${role.name}`);
                            }
                        } catch (error) {
                            // Ignoruj błędy pobierania ról
                        }
                    }
                }
            }

            logger.info(`📊 Wynik: +${addedRoles.length} -${removedRoles.length}`);

            // Jeśli są jakieś zmiany, wyślij embed
            if (addedRoles.length > 0 || removedRoles.length > 0) {
                logger.info(`🚀 Wysyłam embed dla ${member.displayName}`);
                await this.sendRoleChangeEmbed(member, addedRoles, removedRoles, executor);
            } else {
                logger.info(`❌ Brak zmian ról do wysłania`);
            }

        } catch (error) {
            logger.error(`❌ Błąd przetwarzania audit entry: ${error.message}`);
        }
    }

    /**
     * Wysyła embed ze zmianami ról
     * @param {GuildMember} member - Członek serwera
     * @param {Array} addedRoles - Dodane role
     * @param {Array} removedRoles - Usunięte role
     * @param {User} executor - Kto wykonał zmianę
     */
    async sendRoleChangeEmbed(member, addedRoles, removedRoles, executor) {
        try {
            const logChannel = await this.client.channels.fetch(this.logChannelId);
            if (!logChannel) return;

            // Określ kolor embeda
            let color = 0x808080; // Szary domyślny
            if (addedRoles.length > 0 && removedRoles.length === 0) {
                color = 0x00FF00; // Zielony - tylko dodano
            } else if (removedRoles.length > 0 && addedRoles.length === 0) {
                color = 0xFF0000; // Czerwony - tylko usunięto
            }

            const embed = new EmbedBuilder()
                .setTitle(`🔄 ${member.displayName}`)
                .setColor(color)
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
                .setTimestamp();

            // Dodaj informacje o użytkowniku
            embed.addFields({
                name: '👤 Użytkownik',
                value: `**${member.displayName}** (${member.user.tag})`,
                inline: false
            });

            // Dodaj dodane role
            if (addedRoles.length > 0) {
                const rolesList = addedRoles.map(role => `<@&${role.id}>`).join(' ');
                embed.addFields({
                    name: `✅ Dodano ${addedRoles.length === 1 ? 'rolę' : 'role'}\n`,
                    value: rolesList,
                    inline: false
                });
            }

            // Dodaj usunięte role
            if (removedRoles.length > 0) {
                const rolesList = removedRoles.map(role => `<@&${role.id}>`).join(' ');
                embed.addFields({
                    name: `❌ Usunięto ${removedRoles.length === 1 ? 'rolę' : 'role'}\n`,
                    value: rolesList,
                    inline: false
                });
            }

            // Dodaj wykonawcę jeśli to nie sama osoba
            if (executor && executor.id !== member.id) {
                embed.addFields({
                    name: '🔧 Wykonawca',
                    value: `${executor.tag}`,
                    inline: true
                });
            }

            // Ustaw ikonę roli jako thumbnail (pierwsza z listy)
            const primaryRole = addedRoles[0] || removedRoles[0];
            if (primaryRole && primaryRole.iconURL()) {
                embed.setImage(primaryRole.iconURL());
            }

            await logChannel.send({ embeds: [embed] });
            
            logger.info(`📊 Wysłano log zmian ról dla ${member.displayName}: +${addedRoles.length} -${removedRoles.length}`);

        } catch (error) {
            logger.error(`Błąd podczas wysyłania logu zmian ról: ${error.message}`);
        }
    }

    /**
     * Zatrzymuje serwis
     */
    cleanup() {
        if (this.auditCheckInterval) {
            clearInterval(this.auditCheckInterval);
            this.auditCheckInterval = null;
        }
        this.processedAuditLogs.clear();
        logger.info('Zatrzymano serwis logowania zmian ról');
    }
}

module.exports = RoleChangeLogService;