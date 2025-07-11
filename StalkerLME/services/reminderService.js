const { EmbedBuilder } = require('discord.js');
const messages = require('../config/messages');

const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
class ReminderService {
    constructor(config) {
        this.config = config;
    }

    async sendReminders(guild, foundUsers) {
        try {
            logger.info('\n📢 ==================== WYSYŁANIE PRZYPOMNIEŃ ====================');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`👥 Znalezieni użytkownicy: ${foundUsers.length}`);
            
            const timeUntilDeadline = this.calculateTimeUntilDeadline();
            const roleGroups = new Map();
            let sentMessages = 0;
            
            // Grupuj użytkowników według ról
            for (const userData of foundUsers) {
                const { member } = userData;
                
                for (const [roleKey, roleId] of Object.entries(this.config.targetRoles)) {
                    if (member.roles.cache.has(roleId)) {
                        if (!roleGroups.has(roleKey)) {
                            roleGroups.set(roleKey, []);
                        }
                        roleGroups.get(roleKey).push(member);
                        break;
                    }
                }
            }
            
            // Wyślij przypomnienia dla każdej grupy ról
            for (const [roleKey, members] of roleGroups) {
                const roleId = this.config.targetRoles[roleKey];
                const warningChannelId = this.config.warningChannels[roleId];
                
                if (warningChannelId) {
                    const warningChannel = guild.channels.cache.get(warningChannelId);
                    
                    if (warningChannel) {
                        const userMentions = members.map(member => member.toString()).join(' ');
                        const timeMessage = messages.formatTimeMessage(timeUntilDeadline);
                        const reminderMessage = messages.reminderMessage(timeMessage, userMentions);
                        
                        await warningChannel.send(reminderMessage);
                        sentMessages++;
                        
                        logger.info(`✅ Wysłano przypomnienie do kanału ${warningChannel.name} (${warningChannel.id}) dla ${members.length} użytkowników`);
                        logger.info(`💬 Treść przypomnienia: ${reminderMessage.substring(0, 100)}...`);
                    }
                }
            }
            
            logger.info('\n📊 PODSUMOWANIE PRZYPOMNIEŃ:');
            logger.info(`📤 Wysłanych wiadomości: ${sentMessages}`);
            logger.info(`🎭 Grup ról: ${roleGroups.size}`);
            logger.info(`👥 Łączna liczba użytkowników: ${foundUsers.length}`);
            logger.info('✅ Przypomnienia zostały pomyślnie wysłane');
            
            return {
                sentMessages: sentMessages,
                roleGroups: roleGroups.size,
                totalUsers: foundUsers.length
            };
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD PRZYPOMNIEŃ ====================');
            logger.error('❌ Błąd wysyłania przypomnień:', error);
            throw error;
        }
    }

    calculateTimeUntilDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }
        
        const timeDiff = deadline - polandTime;
        const totalMinutes = Math.floor(timeDiff / (1000 * 60));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        return {
            totalMinutes: totalMinutes,
            hours: hours,
            minutes: minutes
        };
    }

    async sendRoleReminders(guild, roleId) {
        try {
            logger.info('\n📢 ==================== PRZYPOMNIENIA DLA ROLI ====================');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`🎭 Rola: ${roleId}`);
            
            const role = guild.roles.cache.get(roleId);
            
            if (!role) {
                throw new Error('Nie znaleziono roli');
            }
            
            const members = role.members;
            const remindersSent = [];
            
            for (const [userId, member] of members) {
                try {
                    const timeLeft = this.calculateTimeUntilDeadline();
                    
                    const embed = new EmbedBuilder()
                        .setTitle('⏰ PRZYPOMNIENIE O BOSSIE')
                        .setDescription(`Czas do deadline: **${timeLeft}**\n\nPamiętaj o pokonaniu bossa, aby uniknąć punktów karnych!`)
                        .setColor('#FFA500')
                        .setTimestamp()
                        .setFooter({ text: 'System automatycznych przypomnień' });
                    
                    await member.send({ embeds: [embed] });
                    remindersSent.push(member);
                    
                    logger.info(`✅ Wysłano przypomnienie do ${member.displayName} (${member.id})`);
                } catch (error) {
                    logger.info(`⚠️ Nie udało się wysłać przypomnienia do ${member.displayName}: ${error.message}`);
                }
            }
            
            logger.info('\n📊 PODSUMOWANIE PRZYPOMNIEŃ ROLI:');
            logger.info(`📤 Wysłanych przypomnień: ${remindersSent.length}`);
            logger.info(`👥 Członków roli: ${members.size}`);
            logger.info('✅ Przypomnienia dla roli zostały zakończone');
            
            return remindersSent;
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD PRZYPOMNIEŃ ROLI ====================');
            logger.error('❌ Błąd wysyłania przypomnień do roli:', error);
            throw error;
        }
    }

    async sendBulkReminder(guild, roleId, customMessage = null) {
        try {
            logger.info('\n📢 ==================== MASOWE PRZYPOMNIENIE ====================');
            logger.info(`🏰 Serwer: ${guild.name} (${guild.id})`);
            logger.info(`🎭 Rola: ${roleId}`);
            
            const role = guild.roles.cache.get(roleId);
            
            if (!role) {
                throw new Error('Nie znaleziono roli');
            }
            
            const timeLeft = this.calculateTimeUntilDeadline();
            
            const embed = new EmbedBuilder()
                .setTitle('⏰ PRZYPOMNIENIE O BOSSIE')
                .setDescription(customMessage || `Czas do deadline: **${timeLeft}**\n\nPamiętaj o pokonaniu bossa, aby uniknąć punktów karnych!`)
                .setColor('#FFA500')
                .setTimestamp()
                .setFooter({ text: 'System automatycznych przypomnień' });
            
            const warningChannelId = this.config.warningChannels[roleId];
            
            if (warningChannelId) {
                const warningChannel = guild.channels.cache.get(warningChannelId);
                
                if (warningChannel) {
                    await warningChannel.send({ 
                        content: `${role}`,
                        embeds: [embed] 
                    });
                    
                    logger.info(`✅ Wysłano masowe przypomnienie do kanału ${warningChannel.name} (${warningChannel.id})`);
                    logger.info(`💬 Treść: ${customMessage ? 'Niestandardowa wiadomość' : 'Standardowe przypomnienie'}`);
                    return true;
                }
            }
            
            throw new Error('Nie znaleziono kanału ostrzeżeń dla tej roli');
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD MASOWEGO PRZYPOMNIENIA ====================');
            logger.error('❌ Błąd wysyłania masowego przypomnienia:', error);
            throw error;
        }
    }

    isDeadlinePassed() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        return polandTime >= deadline;
    }

    getNextDeadline() {
        const now = new Date();
        const polandTime = new Date(now.toLocaleString('en-US', { timeZone: this.config.timezone }));
        
        const deadline = new Date(polandTime);
        deadline.setHours(this.config.bossDeadline.hour, this.config.bossDeadline.minute, 0, 0);
        
        if (polandTime >= deadline) {
            deadline.setDate(deadline.getDate() + 1);
        }
        
        return deadline;
    }

    formatTimeLeft(timeLeft) {
        if (timeLeft <= 0) {
            return 'Deadline minął!';
        }
        
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else {
            return `${minutes}m`;
        }
    }
}

module.exports = ReminderService;