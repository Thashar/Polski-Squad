const { EmbedBuilder } = require('discord.js');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerEN');

class PunishmentService {
    constructor(config, databaseService) {
        this.config = config;
        this.db = databaseService;
    }

    /**
     * Get server configuration or throw error if not configured
     */
    getServerConfigOrThrow(guildId) {
        const serverConfig = this.config.getServerConfig(guildId);
        if (!serverConfig) {
            throw new Error(`Bot is not configured for server ${guildId}. Check servers.json configuration.`);
        }
        return serverConfig;
    }

    async processPunishments(guild, foundUsers) {
        try {
            logger.info('Adding punishment points');
            logger.info(`🏰 Server: ${guild.name} (${guild.id})`);
            logger.info(`👥 Number of users: ${foundUsers.length}`);

            const results = [];

            for (const userData of foundUsers) {
                const { userId, member, matchedName } = userData;

                logger.info(`\n👤 Processing: ${member.displayName} (${userId})`);
                const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, 1, 'Failed to defeat boss');

                logger.info(`📊 New point total: ${userPunishment.points}`);

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

                logger.info(`✅ Successfully updated points for ${member.displayName}`);
            }

            logger.info(`\n✅ Finished adding points for ${results.length} user(s)`);
            return results;
        } catch (error) {
            logger.error('Error adding punishment points');
            logger.error('❌ Error processing punishments:', error);
            throw error;
        }
    }

    async updateUserRoles(member, points) {
        try {
            logger.info('Updating roles');
            logger.info(`👤 User: ${member.displayName} (${member.id})`);
            logger.info(`📊 Points: ${points}`);

            // Get server-specific configuration
            const serverConfig = this.getServerConfigOrThrow(member.guild.id);

            const punishmentRole = member.guild.roles.cache.get(serverConfig.punishmentRoleId);
            const lotteryBanRole = member.guild.roles.cache.get(serverConfig.lotteryBanRoleId);

            if (!punishmentRole) {
                return '❌ Punishment role not found';
            }

            if (!lotteryBanRole) {
                return '❌ Lottery ban role not found';
            }

            const hasPunishmentRole = member.roles.cache.has(serverConfig.punishmentRoleId);
            const hasLotteryBanRole = member.roles.cache.has(serverConfig.lotteryBanRoleId);

            let messages = [];

            // Logic for 3+ points (lottery ban)
            if (points >= this.config.pointLimits.lotteryBan) {
                logger.info('🚫 User has 3+ points - applying lottery ban');

                // Remove punishment role (2+ points) if they have it
                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Removed punishment role`);
                    logger.info('➖ Removed punishment role (2+ points)');
                }

                // Add lottery ban role (3+ points) if they don't have it
                if (!hasLotteryBanRole) {
                    await member.roles.add(lotteryBanRole);
                    messages.push(`🚨 Added lottery ban role`);
                    logger.info('🚨 Added lottery ban role (3+ points)');
                } else {
                    logger.info('User already has lottery ban role');
                }

            // Logic for 2 points (punishment role only)
            } else if (points >= this.config.pointLimits.punishmentRole) {
                logger.info('⚠️ User has 2 points - applying punishment role');

                // Remove lottery ban role if they have it
                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Removed lottery ban role`);
                    logger.info('➖ Removed lottery ban role');
                }

                // Add punishment role if they don't have it
                if (!hasPunishmentRole) {
                    await member.roles.add(punishmentRole);
                    messages.push(`🎭 Added punishment role`);
                    logger.info('🎭 Added punishment role (2+ points)');
                } else {
                    logger.info('User already has punishment role');
                }

            // Logic for 0-1 points (no punishment roles)
            } else {
                logger.info('✅ User has less than 2 points - removing all punishment roles');

                if (hasLotteryBanRole) {
                    await member.roles.remove(lotteryBanRole);
                    messages.push(`➖ Removed lottery ban role`);
                    logger.info('➖ Removed lottery ban role');
                }

                if (hasPunishmentRole) {
                    await member.roles.remove(punishmentRole);
                    messages.push(`➖ Removed punishment role`);
                    logger.info('➖ Removed punishment role');
                }

                if (!hasLotteryBanRole && !hasPunishmentRole) {
                    logger.info('User has no punishment roles');
                }
            }

            const result = messages.length > 0 ? messages.join(', ') : 'No role changes';
            logger.info(`✅ Finished updating roles: ${result}`);

            return `${member.displayName}: ${result}`;
        } catch (error) {
            logger.error(`❌ Error updating roles: ${error.message}`);
            return `❌ Error updating roles: ${error.message}`;
        }
    }

    async sendWarningIfNeeded(guild, member, points) {
        try {
            if (points !== 2 && points !== 3 && points !== 5) {
                return `Not sending warning for ${points} points (only for 2, 3, and 5)`;
            }

            // Get server-specific configuration
            const serverConfig = this.getServerConfigOrThrow(guild.id);

            const userRoleId = this.getUserRoleId(member, serverConfig);
            if (!userRoleId) {
                return '❌ User role not found';
            }

            const warningChannelId = serverConfig.warningChannels[userRoleId];
            if (!warningChannelId) {
                return `❌ No warning channel for role ${userRoleId}`;
            }

            const warningChannel = guild.channels.cache.get(warningChannelId);
            if (!warningChannel) {
                return `❌ Warning channel not found ${warningChannelId}`;
            }

            let message = '';
            if (points === 2) {
                message = `⚠️ **WARNING** ⚠️\n\n${member} has received a punishment role for accumulated penalty points!\n\n**Current penalty points:** ${points}\n**Reason:** Insufficient boss battles`;
            } else if (points === 3) {
                message = `🚨 **LOTTERY BAN** 🚨\n\n${member} has been excluded from the Glory lottery!\n\n**Current penalty points:** ${points}\n**Reason:** Exceeded the 3 penalty point limit`;
            } else if (points === 5) {
                message = `🔴 **CLAN REMOVAL** 🔴\n\n${member} has reached the maximum penalty points and is being removed from the clan!\n\n**Current penalty points:** ${points}\n**Reason:** Reached maximum penalty point limit`;
            }

            if (message) {
                await warningChannel.send(message);
                return `✅ Successfully sent warning for ${points} points to channel ${warningChannel.name} (${warningChannel.id})`;
            }

            return '❌ No message to send';
        } catch (error) {
            return `❌ Error sending warning: ${error.message}`;
        }
    }

    getUserRoleId(member, serverConfig) {
        for (const roleId of Object.values(serverConfig.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                return roleId;
            }
        }
        return null;
    }

    getUserWarningChannel(member, serverConfig) {
        for (const [roleId, channelId] of Object.entries(serverConfig.warningChannels)) {
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
                throw new Error('User not found');
            }

            const userPunishment = await this.db.addPunishmentPoints(guild.id, userId, points, 'Manual point addition');

            await this.updateUserRoles(member, userPunishment.points);
            await this.sendWarningIfNeeded(guild, member, userPunishment.points);

            return userPunishment;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Error manually adding points:', error);
            throw error;
        }
    }

    async removePointsManually(guild, userId, points) {
        try {
            const member = await guild.members.fetch(userId);

            if (!member) {
                throw new Error('User not found');
            }

            const userPunishment = await this.db.removePunishmentPoints(guild.id, userId, points);

            if (userPunishment) {
                await this.updateUserRoles(member, userPunishment.points);
            } else {
                await this.updateUserRoles(member, 0);
            }

            return userPunishment;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Error manually removing points:', error);
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
                        logger.info(`[PUNISHMENT] ⚠️ Cannot find user ${userId}`);
                    }
                }
            }

            ranking.sort((a, b) => b.points - a.points);

            return ranking;
        } catch (error) {
            logger.error('[PUNISHMENT] ❌ Error getting ranking:', error);
            throw error;
        }
    }

    async cleanupAllUsers(guild) {
        try {
            logger.info('Weekly cleanup');
            logger.info(`🏰 Server: ${guild.name} (${guild.id})`);

            const guildPunishments = await this.db.getGuildPunishments(guild.id);

            let usersProcessed = 0;
            let rolesUpdated = 0;

            for (const [userId, userData] of Object.entries(guildPunishments)) {
                try {
                    const member = await guild.members.fetch(userId);

                    if (member) {
                        logger.info(`👤 Cleaning roles for: ${member.displayName}`);
                        const result = await this.updateUserRoles(member, 0);

                        if (!result.includes('No role changes')) {
                            rolesUpdated++;
                        }

                        usersProcessed++;
                    }
                } catch (error) {
                    logger.info(`⚠️ Cannot update roles for user ${userId}: ${error.message}`);
                }
            }

            await this.db.cleanupWeeklyPoints();

            logger.info('Weekly cleanup summary:');
            logger.info(`👥 Users processed: ${usersProcessed}`);
            logger.info(`🎭 Roles updated: ${rolesUpdated}`);
            logger.info('✅ Finished weekly punishment cleanup');
        } catch (error) {
            logger.error('Cleanup error');
            logger.error('❌ Error cleaning punishments:', error);
        }
    }
}

module.exports = PunishmentService;
