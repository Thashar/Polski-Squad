const { EmbedBuilder } = require('discord.js');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
class PunishmentService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
    }

    async processPunishments(guild, foundUsers) {
        try {
            logger.info('\n💾 ==================== DODAWANIE PUNKTÓW ====================');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`👥 Liczba użytkowników: ${foundUsers.length}`);
            
            const results = [];
            
            for (const userData of foundUsers) {
                const { userId, member, matchedName } = userData;
                
                logger.info(`\n👤 Przetwarzanie: ${member.displayName} (${userId})`);
                const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, 1, 'Niepokonanie bossa');
                
                logger.info(`📊 Nowa liczba punktów: ${userPunishment.points}`);
                
                const roleResult = await this.updateUserRoles(member, userPunishment.points);
                logger.info(`🎭 ${roleResult}`);
                
                const warningResult = await this.sendWarningIfNeeded(guild, member, userPunishment.points);
                if (warningResult) {
                    logger.info(`📢 ${warningResult}`);
                }
                
                results.push({
                    user: member,
                    points: userPunishment.points,
                    matchedName: matchedName
                });
                
                logger.info(`✅ Pomyślnie zaktualizowano punkty dla ${member.displayName}`);
            }
            
            logger.info(`\n✅ Zakończono dodawanie punktów dla ${results.length} użytkowników`);
            return results;
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD DODAWANIA PUNKTÓW ====================');
            logger.error('❌ Błąd przetwarzania kar:', error);
            throw error;
        }
    }

    async updateUserRoles(member, points) {
        try {
            logger.info(`\n🎭 ==================== AKTUALIZACJA RÓL ====================`);
            logger.info(`👤 Użytkownik: ${member.displayName} (${member.id})`);
            logger.info(`📊 Punkty: ${points}`);
            
            const punishmentRole = member.guild.roles.cache.get(this.config.punishmentRoleId);
            const lotteryBanRole = member.guild.roles.cache.get(this.config.lotteryBanRoleId);
            
            if (!punishmentRole) {
                return '❌ Nie znaleziono roli karania';
            }
            
            if (!lotteryBanRole) {
                return '❌ Nie znaleziono roli zakazu loterii';
            }
            
            const hasPunishmentRole = member.roles.cache.has(this.config.punishmentRoleId);
            const hasLotteryBanRole = member.roles.cache.has(this.config.lotteryBanRoleId);
            
            let messages = [];
            
            // Logika dla 5+ punktów (zakaz loterii)
            if (points >= this.config.pointLimits.lotteryBan) {
                logger.info('🚫 Użytkownik ma 5+ punktów - stosowanie zakazu loterii');
                
                // Usuń rolę karania (3+ punktów) jeśli ma
                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Usunięto rolę karania`);
                    logger.info('➖ Usunięto rolę karania (3+ punktów)');
                }
                
                // Dodaj rolę zakazu loterii (5+ punktów) jeśli nie ma
                if (!hasLotteryBanRole) {
                    await member.roles.add(lotteryBanRole);
                    messages.push(`🚨 Nadano rolę zakazu loterii`);
                    logger.info('🚨 Nadano rolę zakazu loterii (5+ punktów)');
                } else {
                    logger.info('ℹ️ Użytkownik już ma rolę zakazu loterii');
                }
                
            // Logika dla 3-4 punktów (tylko rola karania)
            } else if (points >= this.config.pointLimits.punishmentRole) {
                logger.info('⚠️ Użytkownik ma 3-4 punkty - stosowanie roli karania');
                
                // Usuń rolę zakazu loterii jeśli ma
                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Usunięto rolę zakazu loterii`);
                    logger.info('➖ Usunięto rolę zakazu loterii');
                }
                
                // Dodaj rolę karania jeśli nie ma
                if (!hasPunishmentRole) {
                    await member.roles.add(punishmentRole);
                    messages.push(`🎭 Nadano rolę karania`);
                    logger.info('🎭 Nadano rolę karania (3+ punktów)');
                } else {
                    logger.info('ℹ️ Użytkownik już ma rolę karania');
                }
                
            // Logika dla 0-2 punktów (brak ról karnych)
            } else {
                logger.info('✅ Użytkownik ma mniej niż 3 punkty - usuwanie wszystkich ról karnych');
                
                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Usunięto rolę zakazu loterii`);
                    logger.info('➖ Usunięto rolę zakazu loterii');
                }
                
                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Usunięto rolę karania`);
                    logger.info('➖ Usunięto rolę karania');
                }
                
                if (!hasLotteryBanRole && !hasPunishmentRole) {
                    logger.info('ℹ️ Użytkownik nie ma ról karnych');
                }
            }
            
            const result = messages.length > 0 ? messages.join(', ') : `ℹ️ Brak zmian w rolach`;
            logger.info(`✅ Zakończono aktualizację ról: ${result}`);
            
            return `${member.displayName}: ${result}`;
        } catch (error) {
            logger.error(`❌ Błąd aktualizacji ról: ${error.message}`);
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
                message = `⚠️ **OSTRZEŻENIE** ⚠️\n\n${member} otrzymał rolę karną za zebrane punkty karne!\n\n**Aktualne punkty:** ${points}\n**Przyczyna:** Niewystarczająca ilość walk z bossem\n\n*Punkty automatycznie znikają co poniedziałek o północy (1 na tydzień).*`;
            } else if (points === 5) {
                message = `🚨 **ZAKAZ LOTERII** 🚨\n\n${member} został wykluczony z loterii Glory!\n\n**Aktualne punkty:** ${points}\n**Przyczyna:** Przekroczenie limitu 5 punktów kary\n\n*Punkty automatycznie znikają co poniedziałek o północy (1 na tydzień).*`;
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
            logger.error('[PUNISHMENT] ❌ Błąd ręcznego dodawania punktów:', error);
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
            logger.error('[PUNISHMENT] ❌ Błąd ręcznego usuwania punktów:', error);
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
                        logger.info(`[PUNISHMENT] ⚠️ Nie można znaleźć użytkownika ${userId}`);
                    }
                }
            }
            
            ranking.sort((a, b) => b.points - a.points);
            
            return ranking;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Błąd pobierania rankingu:', error);
            throw error;
        }
    }

    async cleanupAllUsers(guild) {
        try {
            logger.info('\n🧹 ==================== TYGODNIOWE CZYSZCZENIE ====================');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            
            const guildPunishments = await this.db.getGuildPunishments(guild.id);
            
            let usersProcessed = 0;
            let rolesUpdated = 0;
            
            for (const [userId, userData] of Object.entries(guildPunishments)) {
                try {
                    const member = await guild.members.fetch(userId);
                    
                    if (member) {
                        logger.info(`👤 Czyszczenie ról dla: ${member.displayName}`);
                        const result = await this.updateUserRoles(member, 0);
                        
                        if (!result.includes('Brak zmian')) {
                            rolesUpdated++;
                        }
                        
                        usersProcessed++;
                    }
                } catch (error) {
                    logger.info(`⚠️ Nie można zaktualizować ról dla użytkownika ${userId}: ${error.message}`);
                }
            }
            
            await this.db.cleanupWeeklyPoints();
            
            logger.info('\n📊 PODSUMOWANIE TYGODNIOWEGO CZYSZCZENIA:');
            logger.info(`👥 Użytkowników przetworzonych: ${usersProcessed}`);
            logger.info(`🎭 Role zaktualizowane: ${rolesUpdated}`);
            logger.info('✅ Zakończono tygodniowe czyszczenie kar');
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD CZYSZCZENIA ====================');
            logger.error('❌ Błąd czyszczenia kar:', error);
        }
    }
}

module.exports = PunishmentService;