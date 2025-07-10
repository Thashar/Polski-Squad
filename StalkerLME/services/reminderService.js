const { EmbedBuilder } = require('discord.js');
const messages = require('../config/messages');

class ReminderService {
    constructor(config) {
        this.config = config;
    }

    async sendReminders(guild, foundUsers) {
        try {
            console.log('\n📢 ==================== WYSYŁANIE PRZYPOMNIEŃ ====================');
            console.log(`🏰 Serwer: ${guild.name} (${guild.id})`);
            console.log(`👥 Znalezieni użytkownicy: ${foundUsers.length}`);
            
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
                        
                        console.log(`✅ Wysłano przypomnienie do kanału ${warningChannel.name} (${warningChannel.id}) dla ${members.length} użytkowników`);
                        console.log(`💬 Treść przypomnienia: ${reminderMessage.substring(0, 100)}...`);
                    }
                }
            }
            
            console.log('\n📊 PODSUMOWANIE PRZYPOMNIEŃ:');
            console.log(`📤 Wysłanych wiadomości: ${sentMessages}`);
            console.log(`🎭 Grup ról: ${roleGroups.size}`);
            console.log(`👥 Łączna liczba użytkowników: ${foundUsers.length}`);
            console.log('✅ Przypomnienia zostały pomyślnie wysłane');
            
            return {
                sentMessages: sentMessages,
                roleGroups: roleGroups.size,
                totalUsers: foundUsers.length
            };
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD PRZYPOMNIEŃ ====================');
            console.error('❌ Błąd wysyłania przypomnień:', error);
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
            console.log('\n📢 ==================== PRZYPOMNIENIA DLA ROLI ====================');
            console.log(`🏰 Serwer: ${guild.name} (${guild.id})`);
            console.log(`🎭 Rola: ${roleId}`);
            
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
                    
                    console.log(`✅ Wysłano przypomnienie do ${member.displayName} (${member.id})`);
                } catch (error) {
                    console.log(`⚠️ Nie udało się wysłać przypomnienia do ${member.displayName}: ${error.message}`);
                }
            }
            
            console.log('\n📊 PODSUMOWANIE PRZYPOMNIEŃ ROLI:');
            console.log(`📤 Wysłanych przypomnień: ${remindersSent.length}`);
            console.log(`👥 Członków roli: ${members.size}`);
            console.log('✅ Przypomnienia dla roli zostały zakończone');
            
            return remindersSent;
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD PRZYPOMNIEŃ ROLI ====================');
            console.error('❌ Błąd wysyłania przypomnień do roli:', error);
            throw error;
        }
    }

    async sendBulkReminder(guild, roleId, customMessage = null) {
        try {
            console.log('\n📢 ==================== MASOWE PRZYPOMNIENIE ====================');
            console.log(`🏰 Serwer: ${guild.name} (${guild.id})`);
            console.log(`🎭 Rola: ${roleId}`);
            
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
                    
                    console.log(`✅ Wysłano masowe przypomnienie do kanału ${warningChannel.name} (${warningChannel.id})`);
                    console.log(`💬 Treść: ${customMessage ? 'Niestandardowa wiadomość' : 'Standardowe przypomnienie'}`);
                    return true;
                }
            }
            
            throw new Error('Nie znaleziono kanału ostrzeżeń dla tej roli');
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD MASOWEGO PRZYPOMNIENIA ====================');
            console.error('❌ Błąd wysyłania masowego przypomnienia:', error);
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