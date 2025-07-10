const { EmbedBuilder } = require('discord.js');

class PunishmentService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
    }

    async processPunishments(guild, foundUsers) {
        try {
            console.log('\n💾 ==================== DODAWANIE PUNKTÓW ====================');
            console.log(`🏰 Serwer: ${guild.name} (${guild.id})`);
            console.log(`👥 Liczba użytkowników: ${foundUsers.length}`);
            
            const results = [];
            
            for (const userData of foundUsers) {
                const { userId, member, matchedName } = userData;
                
                console.log(`\n👤 Przetwarzanie: ${member.displayName} (${userId})`);
                const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, 1, 'Niepokonanie bossa');
                
                console.log(`📊 Nowa liczba punktów: ${userPunishment.points}`);
                
                const roleResult = await this.updateUserRoles(member, userPunishment.points);
                console.log(`🎭 ${roleResult}`);
                
                const warningResult = await this.sendWarningIfNeeded(guild, member, userPunishment.points);
                if (warningResult) {
                    console.log(`📢 ${warningResult}`);
                }
                
                results.push({
                    user: member,
                    points: userPunishment.points,
                    matchedName: matchedName
                });
                
                console.log(`✅ Pomyślnie zaktualizowano punkty dla ${member.displayName}`);
            }
            
            console.log(`\n✅ Zakończono dodawanie punktów dla ${results.length} użytkowników`);
            return results;
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD DODAWANIA PUNKTÓW ====================');
            console.error('❌ Błąd przetwarzania kar:', error);
            throw error;
        }
    }

    async updateUserRoles(member, points) {
        try {
            const punishmentRole = member.guild.roles.cache.get(this.config.punishmentRoleId);
            
            if (!punishmentRole) {
                return '❌ Nie znaleziono roli karania';
            }
            
            const hasRole = member.roles.cache.has(this.config.punishmentRoleId);
            const shouldHaveRole = points >= this.config.pointLimits.punishmentRole;
            
            if (shouldHaveRole && !hasRole) {
                await member.roles.add(punishmentRole);
                return `✅ Nadano rolę karania użytkownikowi ${member.displayName}`;
            } else if (!shouldHaveRole && hasRole) {
                await member.roles.remove(punishmentRole);
                return `✅ Usunięto rolę karania użytkownikowi ${member.displayName}`;
            } else {
                return `ℹ️ Brak zmian w roli dla użytkownika ${member.displayName}`;
            }
        } catch (error) {
            return `❌ Błąd aktualizacji ról: ${error.message}`;
        }
    }

    async sendWarningIfNeeded(guild, member, points) {
        try {
            if (points !== 3 && points !== 5) {
                return `ℹ️ Nie wysyłam ostrzeżenia dla ${points} punktów (tylko dla 3 i 5)`;
            }
            
            const userRoleId = this.getUserRoleId(member);
            if (!userRoleId) {
                return '❌ Nie znaleziono roli użytkownika';
            }
            
            const warningChannelId = this.config.warningChannels[userRoleId];
            if (!warningChannelId) {
                return `❌ Brak kanału ostrzeżeń dla roli ${userRoleId}`;
            }
            
            const warningChannel = guild.channels.cache.get(warningChannelId);
            if (!warningChannel) {
                return `❌ Nie znaleziono kanału ostrzeżeń ${warningChannelId}`;
            }
            
            let message = '';
            if (points === 3) {
                message = `⚠️ **OSTRZEŻENIE** ⚠️\n\n${member} otrzymał rolę karną za zbieranie punktów!\n\n**Aktualne punkty:** ${points}\n**Przyczyna:** Niepokonanie bossa\n\n*Punkty automatycznie znikają co poniedziałek o północy.*`;
            } else if (points === 5) {
                message = `🚨 **ZAKAZ LOTERII** 🚨\n\n${member} został wykluczony z loterii!\n\n**Aktualne punkty:** ${points}\n**Przyczyna:** Przekroczenie limitu 5 punktów\n\n*Punkty automatycznie znikają co poniedziałek o północy.*`;
            }
            
            if (message) {
                await warningChannel.send(message);
                return `✅ Pomyślnie wysłano ostrzeżenie dla ${points} punktów na kanał ${warningChannel.name} (${warningChannel.id})`;
            }
            
            return '❌ Brak wiadomości do wysłania';
        } catch (error) {
            return `❌ Błąd wysyłania ostrzeżenia: ${error.message}`;
        }
    }

    getUserRoleId(member) {
        for (const roleId of Object.values(this.config.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                return roleId;
            }
        }
        return null;
    }

    getUserWarningChannel(member) {
        for (const [roleId, channelId] of Object.entries(this.config.warningChannels)) {
            if (member.roles.cache.has(roleId)) {
                return channelId;
            }
        }
        return null;
    }

    async addPointsManually(guild, userId, points) {
        try {
            const member = await guild.members.fetch(userId);
            
            if (!member) {
                throw new Error('Nie znaleziono użytkownika');
            }
            
            const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, points, 'Ręczne dodanie punktów');
            
            await this.updateUserRoles(member, userPunishment.points);
            await this.sendWarningIfNeeded(guild, member, userPunishment.points);
            
            return userPunishment;
        } catch (error) {
            console.error('[PUNISHMENT] ❌ Błąd ręcznego dodawania punktów:', error);
            throw error;
        }
    }

    async removePointsManually(guild, userId, points) {
        try {
            const member = await guild.members.fetch(userId);
            
            if (!member) {
                throw new Error('Nie znaleziono użytkownika');
            }
            
            const userPunishment = await this.db.removePunishmentPoints(guild.id, userId, points);
            
            if (userPunishment) {
                await this.updateUserRoles(member, userPunishment.points);
            } else {
                await this.updateUserRoles(member, 0);
            }
            
            return userPunishment;
        } catch (error) {
            console.error('[PUNISHMENT] ❌ Błąd ręcznego usuwania punktów:', error);
            throw error;
        }
    }

    async getRankingForRole(guild, roleId) {
        try {
            const guildPunishments = await this.db.getGuildPunishments(guild.id);
            const ranking = [];
            
            for (const [userId, userData] of Object.entries(guildPunishments)) {
                if (userData.points > 0) {
                    try {
                        const member = await guild.members.fetch(userId);
                        
                        if (member && member.roles.cache.has(roleId)) {
                            ranking.push({
                                member: member,
                                points: userData.points,
                                history: userData.history
                            });
                        }
                    } catch (error) {
                        console.log(`[PUNISHMENT] ⚠️ Nie można znaleźć użytkownika ${userId}`);
                    }
                }
            }
            
            ranking.sort((a, b) => b.points - a.points);
            
            return ranking;
        } catch (error) {
            console.error('[PUNISHMENT] ❌ Błąd pobierania rankingu:', error);
            throw error;
        }
    }

    async cleanupAllUsers(guild) {
        try {
            const guildPunishments = await this.db.getGuildPunishments(guild.id);
            
            for (const [userId, userData] of Object.entries(guildPunishments)) {
                try {
                    const member = await guild.members.fetch(userId);
                    
                    if (member) {
                        await this.updateUserRoles(member, 0);
                    }
                } catch (error) {
                    console.log(`[PUNISHMENT] ⚠️ Nie można zaktualizować ról dla użytkownika ${userId}`);
                }
            }
            
            await this.db.cleanupWeeklyPoints();
            console.log('[PUNISHMENT] ✅ Zakończono tygodniowe czyszczenie kar');
        } catch (error) {
            console.error('[PUNISHMENT] ❌ Błąd czyszczenia kar:', error);
        }
    }
}

module.exports = PunishmentService;