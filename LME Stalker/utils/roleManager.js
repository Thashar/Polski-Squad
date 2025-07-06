const client = require('../index');
const config = require('../config/config');

/**
 * Funkcja do zarządzania rolą użytkownika na podstawie liczby punktów
 */
async function manageUserRole(userId, points, guildId) {
    console.log(`\n🎭 ==================== ZARZĄDZANIE ROLĄ ====================`);
    console.log(`👤 Użytkownik: ${userId}`);
    console.log(`📊 Punkty: ${points}`);
    console.log(`🏰 Serwer: ${guildId}`);
    console.log(`🎭 Rola karania: ${config.PUNISHMENT_ROLE_ID}`);
    
    try {
        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
            console.log('❌ Nie znaleziono serwera');
            return { success: false, message: 'Serwer nie znaleziony' };
        }
        
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) {
            console.log('❌ Nie znaleziono użytkownika na serwerze');
            return { success: false, message: 'Użytkownik nie znaleziony na serwerze' };
        }
        
        const role = guild.roles.cache.get(config.PUNISHMENT_ROLE_ID);
        if (!role) {
            console.log('❌ Nie znaleziono roli karania');
            return { success: false, message: 'Rola karania nie znaleziona' };
        }
        
        const hasRole = member.roles.cache.has(config.PUNISHMENT_ROLE_ID);
        const shouldHaveRole = points >= 3;
        
        console.log(`🔍 Użytkownik ma rolę: ${hasRole}`);
        console.log(`🔍 Powinien mieć rolę: ${shouldHaveRole}`);
        
        if (shouldHaveRole && !hasRole) {
            await member.roles.add(config.PUNISHMENT_ROLE_ID);
            console.log(`✅ Nadano rolę karania użytkownikowi ${member.displayName}`);
            return { 
                success: true, 
                action: 'added', 
                message: `Nadano rolę karania użytkownikowi ${member.displayName}` 
            };
        } else if (!shouldHaveRole && hasRole) {
            await member.roles.remove(config.PUNISHMENT_ROLE_ID);
            console.log(`✅ Usunięto rolę karania użytkownikowi ${member.displayName}`);
            return { 
                success: true, 
                action: 'removed', 
                message: `Usunięto rolę karania użytkownikowi ${member.displayName}` 
            };
        } else {
            console.log(`ℹ️ Brak zmian w roli dla użytkownika ${member.displayName}`);
            return { 
                success: true, 
                action: 'no_change', 
                message: `Brak zmian w roli dla użytkownika ${member.displayName}` 
            };
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas zarządzania rolą:', error);
        return { success: false, message: `Błąd podczas zarządzania rolą: ${error.message}` };
    }
}

/**
 * Funkcja do pobrania wszystkich członków z TARGET_ROLES
 */
async function getAllTargetRoleMembers(guild) {
    try {
        await guild.members.fetch();
    } catch (error) {
        console.error('❌ Błąd podczas pobierania członków serwera:', error);
    }
    
    const allTargetMembers = [];
    
    for (const [roleKey, roleId] of Object.entries(config.TARGET_ROLES)) {
        const role = guild.roles.cache.get(roleId);
        if (!role) continue;
        
        const membersWithRole = [];
        guild.members.cache.forEach(member => {
            if (member.roles.cache.has(roleId)) {
                membersWithRole.push(member);
            }
        });
        
        const roleMembers = membersWithRole.map(member => ({
            member: member,
            roleId: roleId,
            roleKey: roleKey,
            roleName: role.name
        }));
        
        allTargetMembers.push(...roleMembers);
    }
    
    const uniqueMembers = [];
    const seenUserIds = new Set();
    
    for (const memberData of allTargetMembers) {
        if (!seenUserIds.has(memberData.member.id)) {
            uniqueMembers.push(memberData);
            seenUserIds.add(memberData.member.id);
        }
    }
    
    console.log(`👥 Znaleziono ${uniqueMembers.length} unikalnych członków do sprawdzenia`);
    return uniqueMembers;
}

/**
 * Funkcja do pobrania członków konkretnej roli
 */
async function getMembersOfRole(guild, roleKey) {
    const roleId = config.TARGET_ROLES[roleKey];
    if (!roleId) return [];
    
    try {
        await guild.members.fetch();
    } catch (error) {
        console.error('❌ Błąd podczas pobierania członków serwera:', error);
    }
    
    const role = guild.roles.cache.get(roleId);
    if (!role) return [];
    
    const membersWithRole = [];
    guild.members.cache.forEach(member => {
        if (member.roles.cache.has(roleId)) {
            membersWithRole.push({
                member: member,
                roleId: roleId,
                roleKey: roleKey,
                roleName: role.name
            });
        }
    });
    
    return membersWithRole;
}

module.exports = {
    manageUserRole,
    getAllTargetRoleMembers,
    getMembersOfRole
};
