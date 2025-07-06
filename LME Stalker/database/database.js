const fs = require('fs').promises;
const path = require('path');
const config = require('../config/config');
const { manageUserRole } = require('../utils/roleManager');
const { sendWarningMessage } = require('../messages/messages');

/**
 * Funkcja do zapewnienia istnienia katalogu data/
 */
async function ensureDataDirectory() {
    const dataDir = path.dirname(config.DATABASE_FILE);
    try {
        await fs.access(dataDir);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`📁 Tworzenie katalogu: ${dataDir}`);
            await fs.mkdir(dataDir, { recursive: true });
        }
    }
}

/**
 * Funkcja do odczytu bazy danych JSON
 */
async function readDatabase() {
    console.log('📖 Odczytywanie bazy danych JSON...');
    console.log(`📍 Ścieżka: ${config.DATABASE_FILE}`);
    
    try {
        await ensureDataDirectory();
        const data = await fs.readFile(config.DATABASE_FILE, 'utf8');
        const parsed = JSON.parse(data);
        console.log('✅ Baza danych JSON wczytana pomyślnie');
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📝 Plik bazy danych nie istnieje, tworzenie nowej bazy...');
            const newDatabase = { guilds: {} };
            await writeDatabase(newDatabase);
            return newDatabase;
        }
        console.error('❌ Błąd podczas odczytu bazy danych JSON:', error);
        throw error;
    }
}

/**
 * Funkcja do zapisu bazy danych JSON
 */
async function writeDatabase(data) {
    console.log('💾 Zapisywanie bazy danych JSON...');
    console.log(`📍 Ścieżka: ${config.DATABASE_FILE}`);
    
    try {
        await ensureDataDirectory();
        const jsonString = JSON.stringify(data, null, 2);
        await fs.writeFile(config.DATABASE_FILE, jsonString, 'utf8');
        console.log('✅ Baza danych JSON zapisana pomyślnie');
        console.log(`📊 Rozmiar pliku: ${jsonString.length} znaków`);
    } catch (error) {
        console.error('❌ Błąd podczas zapisu bazy danych JSON:', error);
        throw error;
    }
}

/**
 * Funkcja do inicjalizacji struktury bazy danych dla serwera
 */
function initializeGuildInDatabase(database, guildId) {
    console.log(`🏰 Inicjalizacja struktury bazy dla serwera: ${guildId}`);
    if (!database.guilds[guildId]) {
        database.guilds[guildId] = {
            users: {}
        };
        console.log('✅ Utworzono nową strukturę dla serwera');
    }
    return database;
}

/**
 * Funkcja do dodawania punktów w bazie JSON z timestampem
 */
async function addPoints(userId, username, roleId, guildId) {
    console.log(`\n💾 Dodawanie punktów w bazie JSON...`);
    console.log(`👤 Użytkownik: ${username} (${userId})`);
    console.log(`🎭 Rola: ${roleId}`);
    console.log(`🏰 Serwer: ${guildId}`);
    
    try {
        const database = await readDatabase();
        initializeGuildInDatabase(database, guildId);
        
        const timestamp = Date.now();
        
        if (database.guilds[guildId].users[userId]) {
            console.log('👤 Użytkownik już istnieje w bazie - aktualizacja punktów');
            
            if (!database.guilds[guildId].users[userId].pointsHistory) {
                database.guilds[guildId].users[userId].pointsHistory = [];
            }
            
            database.guilds[guildId].users[userId].pointsHistory.push({
                timestamp: timestamp,
                reason: 'Nie zbił bossa w LME'
            });
            
            database.guilds[guildId].users[userId].points = database.guilds[guildId].users[userId].pointsHistory.length;
            database.guilds[guildId].users[userId].username = username;
            database.guilds[guildId].users[userId].role_id = roleId;
        } else {
            console.log('👤 Nowy użytkownik - dodawanie do bazy');
            database.guilds[guildId].users[userId] = {
                username: username,
                points: 1,
                role_id: roleId,
                pointsHistory: [{
                    timestamp: timestamp,
                    reason: 'Nie zbił bossa w LME'
                }]
            };
        }
        
        const newPoints = database.guilds[guildId].users[userId].points;
        console.log(`📊 Nowa liczba punktów: ${newPoints}`);
        console.log(`⏰ Timestamp: ${new Date(timestamp).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        await writeDatabase(database);
        
        // Zarządzanie rolą na podstawie punktów
        const roleResult = await manageUserRole(userId, newPoints, guildId);
        if (roleResult.success && roleResult.action !== 'no_change') {
            console.log(`🎭 ${roleResult.message}`);
        }
        
        // Sprawdzenie czy należy wysłać ostrzeżenie
        console.log(`🔔 Sprawdzanie czy wysłać ostrzeżenie dla ${newPoints} punktów...`);
        if (newPoints === 3 || newPoints === 5) {
            console.log(`📢 Wysyłanie ostrzeżenia dla ${newPoints} punktów na kanał roli ${roleId}...`);
            try {
                await sendWarningMessage(userId, newPoints, roleId, guildId);
            } catch (warningError) {
                console.error('❌ Błąd podczas wysyłania ostrzeżenia:', warningError);
            }
        } else {
            console.log(`ℹ️ Brak ostrzeżenia dla ${newPoints} punktów (wysyłam tylko dla 3 i 5)`);
        }
        
        console.log(`✅ Pomyślnie dodano/zaktualizowano punkty dla ${username}`);
        return newPoints;
        
    } catch (error) {
        console.error(`❌ Błąd podczas dodawania punktów dla ${username}:`, error);
        throw error;
    }
}

/**
 * Funkcja do modyfikowania punktów użytkownika
 */
async function modifyPoints(userId, pointsChange, guildId) {
    console.log(`\n🔄 ==================== MODYFIKACJA PUNKTÓW ====================`);
    console.log(`👤 Użytkownik: ${userId}`);
    console.log(`📊 Zmiana punktów: ${pointsChange > 0 ? '+' : ''}${pointsChange}`);
    console.log(`🏰 Serwer: ${guildId}`);
    
    try {
        const database = await readDatabase();
        
        if (!database.guilds[guildId] || !database.guilds[guildId].users || !database.guilds[guildId].users[userId]) {
            console.log('❌ Użytkownik nie istnieje w bazie');
            return { success: false, message: 'Użytkownik nie znajduje się w bazie danych.' };
        }
        
        const userData = database.guilds[guildId].users[userId];
        const userRoleId = userData.role_id;
        console.log(`📊 Aktualne punkty: ${userData.points}`);
        console.log(`🎭 Rola użytkownika: ${userRoleId}`);
        
        if (!userData.pointsHistory || !Array.isArray(userData.pointsHistory)) {
            console.log('🔄 Migracja - tworzenie historii punktów...');
            userData.pointsHistory = [];
            for (let i = 0; i < userData.points; i++) {
                userData.pointsHistory.push({
                    timestamp: Date.now() - (i * 24 * 60 * 60 * 1000),
                    reason: 'Migracja z starego systemu'
                });
            }
        }
        
        const currentPoints = userData.pointsHistory.length;
        
        if (pointsChange > 0) {
            console.log(`➕ Dodawanie ${pointsChange} punktów...`);
            for (let i = 0; i < pointsChange; i++) {
                userData.pointsHistory.push({
                    timestamp: Date.now(),
                    reason: 'Dodane ręcznie przez administratora'
                });
            }
            
            userData.points = userData.pointsHistory.length;
            const newPoints = userData.points;
            
            await writeDatabase(database);
            
            const roleResult = await manageUserRole(userId, newPoints, guildId);
            let roleMessage = '';
            if (roleResult.success && roleResult.action !== 'no_change') {
                roleMessage = ` ${roleResult.message}`;
            }
            
            console.log(`✅ Dodano ${pointsChange} punktów. Nowy stan: ${newPoints}${roleMessage}`);
            
            if (newPoints === 3 || newPoints === 5) {
                console.log(`📢 Wysyłanie ostrzeżenia dla ${newPoints} punktów na kanał roli ${userRoleId}...`);
                try {
                    await sendWarningMessage(userId, newPoints, userRoleId, guildId);
                } catch (warningError) {
                    console.error('❌ Błąd podczas wysyłania ostrzeżenia:', warningError);
                }
            } else {
                console.log(`ℹ️ Brak ostrzeżenia dla ${newPoints} punktów (wysyłam tylko dla 3 i 5)`);
            }
            
            return {
                success: true,
                message: `Pomyślnie dodano ${pointsChange} punktów. Nowy stan: ${newPoints} punktów.${roleMessage}`,
                addedPoints: pointsChange,
                newPoints: newPoints,
                username: userData.username,
                action: 'added',
                roleAction: roleResult.action
            };
            
        } else {
            const pointsToRemove = Math.abs(pointsChange);
            console.log(`➖ Odejmowanie ${pointsToRemove} punktów...`);
            
            const actualPointsToRemove = Math.min(pointsToRemove, currentPoints);
            
            if (actualPointsToRemove === 0) {
                console.log('⚠️ Brak punktów do usunięcia');
                return { 
                    success: true, 
                    message: `Użytkownik ${userData.username} nie ma punktów do usunięcia.`,
                    removedPoints: 0,
                    newPoints: 0,
                    username: userData.username,
                    action: 'removed',
                    roleAction: 'no_change'
                };
            }
            
            userData.pointsHistory.sort((a, b) => a.timestamp - b.timestamp);
            const removedPointsData = userData.pointsHistory.splice(0, actualPointsToRemove);
            
            userData.points = userData.pointsHistory.length;
            const remainingPoints = userData.points;
            
            const roleResult = await manageUserRole(userId, remainingPoints, guildId);
            let roleMessage = '';
            if (roleResult.success && roleResult.action !== 'no_change') {
                roleMessage = ` ${roleResult.message}`;
            }
            
            if (remainingPoints === 0) {
                console.log('🗑️ Użytkownik nie ma już punktów - usuwanie z bazy');
                delete database.guilds[guildId].users[userId];
            }
            
            await writeDatabase(database);
            
            console.log(`✅ Odjęto ${actualPointsToRemove} punktów. Pozostało: ${remainingPoints}${roleMessage}`);
            
            return {
                success: true,
                message: `Pomyślnie odjęto ${actualPointsToRemove} punktów. Pozostało: ${remainingPoints} punktów.${roleMessage}`,
                removedPoints: actualPointsToRemove,
                newPoints: remainingPoints,
                username: userData.username,
                action: 'removed',
                roleAction: roleResult.action
            };
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas modyfikacji punktów:', error);
        throw error;
    }
}

/**
 * Funkcja do pobierania rankingu z bazy JSON
 */
async function getRanking(roleId, guildId) {
    console.log(`\n📊 Pobieranie rankingu z bazy JSON...`);
    console.log(`🎭 Rola: ${roleId}`);
    console.log(`🏰 Serwer: ${guildId}`);
    
    try {
        const database = await readDatabase();
        
        if (!database.guilds[guildId] || !database.guilds[guildId].users) {
            console.log('❌ Brak danych dla tego serwera');
            return [];
        }
        
        const users = database.guilds[guildId].users;
        const ranking = [];
        
        for (const [userId, userData] of Object.entries(users)) {
            if (userData.role_id === roleId && userData.points > 0) {
                ranking.push({
                    user_id: userId,
                    username: userData.username,
                    points: userData.points
                });
            }
        }
        
        ranking.sort((a, b) => b.points - a.points);
        const topRanking = ranking.slice(0, 20);
        
        console.log(`✅ Pobrano ranking: ${topRanking.length} użytkowników`);
        topRanking.forEach((user, index) => {
            console.log(`${index + 1}. ${user.username} - ${user.points} pkt`);
        });
        
        return topRanking;
        
    } catch (error) {
        console.error('❌ Błąd podczas pobierania rankingu:', error);
        throw error;
    }
}

/**
 * Funkcja do usuwania użytkownika z bazy JSON
 */
async function removeUser(userId, guildId) {
    console.log(`\n🗑️ Usuwanie użytkownika z bazy JSON...`);
    console.log(`👤 Użytkownik: ${userId}`);
    console.log(`🏰 Serwer: ${guildId}`);
    
    try {
        const database = await readDatabase();
        
        if (!database.guilds[guildId] || !database.guilds[guildId].users || !database.guilds[guildId].users[userId]) {
            console.log('❌ Użytkownik nie istnieje w bazie');
            return { success: false, username: null, roleAction: 'no_change' };
        }
        
        const username = database.guilds[guildId].users[userId].username;
        delete database.guilds[guildId].users[userId];
        
        await writeDatabase(database);
        
        const roleResult = await manageUserRole(userId, 0, guildId);
        
        console.log(`✅ Użytkownik ${username} został całkowicie usunięty z bazy`);
        return { 
            success: true, 
            username: username,
            roleAction: roleResult.action,
            roleMessage: roleResult.message
        };
        
    } catch (error) {
        console.error('❌ Błąd podczas usuwania użytkownika:', error);
        throw error;
    }
}

/**
 * Funkcja do wyświetlania statystyk bazy danych
 */
async function showDatabaseStats() {
    console.log('\n📊 ==================== STATYSTYKI BAZY DANYCH ====================');
    try {
        const database = await readDatabase();
        const guildsCount = Object.keys(database.guilds).length;
        console.log(`🏰 Liczba serwerów w bazie: ${guildsCount}`);
        
        for (const [guildId, guildData] of Object.entries(database.guilds)) {
            const usersCount = Object.keys(guildData.users).length;
            const totalPoints = Object.values(guildData.users).reduce((sum, user) => sum + user.points, 0);
            console.log(`  🏰 Serwer ${guildId}: ${usersCount} użytkowników, ${totalPoints} łącznych punktów`);
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas wyświetlania statystyk:', error);
    }
}

module.exports = {
    readDatabase,
    writeDatabase,
    initializeGuildInDatabase,
    addPoints,
    modifyPoints,
    getRanking,
    removeUser,
    showDatabaseStats
};
