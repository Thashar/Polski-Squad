const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const config = require('../config/config');
const { readDatabase, writeDatabase } = require('./database');
const { manageUserRole } = require('../utils/roleManager');

/**
 * Funkcja do zapewnienia istnienia katalogu data/
 */
async function ensureDataDirectory() {
    const dataDir = path.dirname(config.WEEKLY_REMOVAL_FILE);
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
 * Funkcja do odczytu pliku weekly_removal.json
 */
async function readWeeklyRemovalData() {
    console.log('📖 Odczytywanie danych o tygodniowym usuwaniu...');
    console.log(`📍 Ścieżka: ${config.WEEKLY_REMOVAL_FILE}`);
    
    try {
        await ensureDataDirectory();
        const data = await fs.readFile(config.WEEKLY_REMOVAL_FILE, 'utf8');
        const parsed = JSON.parse(data);
        console.log('✅ Dane o tygodniowym usuwaniu wczytane pomyślnie');
        return parsed;
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log('📝 Plik weekly_removal.json nie istnieje, tworzenie nowego...');
            const newData = { lastRemovalDate: null, lastRemovalTimestamp: null };
            await writeWeeklyRemovalData(newData);
            return newData;
        }
        console.error('❌ Błąd podczas odczytu danych o tygodniowym usuwaniu:', error);
        throw error;
    }
}

/**
 * Funkcja do zapisu pliku weekly_removal.json
 */
async function writeWeeklyRemovalData(data) {
    console.log('💾 Zapisywanie danych o tygodniowym usuwaniu...');
    console.log(`📍 Ścieżka: ${config.WEEKLY_REMOVAL_FILE}`);
    
    try {
        await ensureDataDirectory();
        const jsonString = JSON.stringify(data, null, 2);
        await fs.writeFile(config.WEEKLY_REMOVAL_FILE, jsonString, 'utf8');
        console.log('✅ Dane o tygodniowym usuwaniu zapisane pomyślnie');
    } catch (error) {
        console.error('❌ Błąd podczas zapisu danych o tygodniowym usuwaniu:', error);
        throw error;
    }
}

/**
 * Funkcja do znajdowania ostatniego poniedziałku o północy
 */
function getLastMondayMidnight() {
    const now = new Date();
    const lastMonday = new Date(now);
    
    const daysFromMonday = (now.getDay() + 6) % 7;
    
    if (daysFromMonday === 0 && now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) {
        lastMonday.setHours(0, 0, 0, 0);
    } else if (daysFromMonday === 0) {
        lastMonday.setHours(0, 0, 0, 0);
    } else {
        lastMonday.setDate(now.getDate() - daysFromMonday);
        lastMonday.setHours(0, 0, 0, 0);
    }
    
    return lastMonday;
}

/**
 * Funkcja do znajdowania następnego poniedziałku o północy
 */
function getNextMondayMidnight() {
    const now = new Date();
    const nextMonday = new Date(now);
    
    const daysUntilMonday = (1 + 7 - now.getDay()) % 7;
    
    if (daysUntilMonday === 0) {
        if (now.getHours() === 0 && now.getMinutes() === 0 && now.getSeconds() === 0) {
            nextMonday.setDate(now.getDate() + 7);
        } else {
            nextMonday.setDate(now.getDate() + 7);
        }
    } else {
        nextMonday.setDate(now.getDate() + daysUntilMonday);
    }
    
    nextMonday.setHours(0, 0, 0, 0);
    return nextMonday;
}

/**
 * Funkcja do obliczania daty następnego usuwania punktów
 */
async function getNextRemovalDate() {
    try {
        const nextMondayMidnight = getNextMondayMidnight();
        
        return nextMondayMidnight.toLocaleString('pl-PL', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Warsaw'
        });
    } catch (error) {
        console.error('❌ Błąd podczas obliczania następnej daty usuwania:', error);
        return 'Błąd obliczania';
    }
}

/**
 * Funkcja do tygodniowego usuwania punktów
 */
async function weeklyPointsRemoval() {
    console.log('\n🗓️ ==================== TYGODNIOWE USUWANIE PUNKTÓW ====================');
    
    try {
        const database = await readDatabase();
        const currentDate = new Date();
        const timestamp = currentDate.getTime();
        
        console.log(`📅 Data usuwania: ${currentDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        let totalUsersModified = 0;
        let totalPointsRemoved = 0;
        let totalRolesModified = 0;
        let guildsProcessed = 0;
        
        for (const [guildId, guildData] of Object.entries(database.guilds)) {
            if (!guildData.users || Object.keys(guildData.users).length === 0) {
                console.log(`⏭️ Serwer ${guildId}: brak użytkowników`);
                continue;
            }
            
            console.log(`\n🏰 Przetwarzanie serwera: ${guildId}`);
            let usersModifiedInGuild = 0;
            let pointsRemovedInGuild = 0;
            let rolesModifiedInGuild = 0;
            
            for (const [userId, userData] of Object.entries(guildData.users)) {
                if (!userData.pointsHistory || !Array.isArray(userData.pointsHistory)) {
                    continue;
                }
                
                if (userData.pointsHistory.length === 0) {
                    continue;
                }
                
                const oldPoints = userData.pointsHistory.length;
                
                const oldestPoint = userData.pointsHistory.shift();
                userData.points = userData.pointsHistory.length;
                const newPoints = userData.points;
                
                usersModifiedInGuild++;
                pointsRemovedInGuild++;
                
                console.log(`➖ ${userData.username}: usunięto 1 punkt (${oldPoints} -> ${newPoints})`);
                
                const roleResult = await manageUserRole(userId, newPoints, guildId);
                if (roleResult.success && roleResult.action !== 'no_change') {
                    rolesModifiedInGuild++;
                    console.log(`🎭 ${userData.username}: ${roleResult.message}`);
                }
                
                if (newPoints === 0) {
                    delete guildData.users[userId];
                    console.log(`🗑️ ${userData.username}: usunięto z bazy (0 punktów)`);
                }
            }
            
            totalUsersModified += usersModifiedInGuild;
            totalPointsRemoved += pointsRemovedInGuild;
            totalRolesModified += rolesModifiedInGuild;
            guildsProcessed++;
            
            console.log(`✅ Serwer ${guildId}: ${usersModifiedInGuild} użytkowników, ${pointsRemovedInGuild} punktów, ${rolesModifiedInGuild} ról`);
        }
        
        await writeDatabase(database);
        
        const removalData = {
            lastRemovalDate: currentDate.toISOString(),
            lastRemovalTimestamp: timestamp
        };
        await writeWeeklyRemovalData(removalData);
        
        console.log('\n📊 PODSUMOWANIE TYGODNIOWEGO USUWANIA:');
        console.log(`🏰 Serwerów przetworzonych: ${guildsProcessed}`);
        console.log(`👥 Użytkowników zmodyfikowanych: ${totalUsersModified}`);
        console.log(`➖ Punktów usuniętych: ${totalPointsRemoved}`);
        console.log(`🎭 Ról zmodyfikowanych: ${totalRolesModified}`);
        console.log(`📅 Data: ${currentDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        return {
            success: true,
            guildsProcessed,
            usersModified: totalUsersModified,
            pointsRemoved: totalPointsRemoved,
            rolesModified: totalRolesModified,
            date: currentDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })
        };
        
    } catch (error) {
        console.error('❌ Błąd podczas tygodniowego usuwania punktów:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Funkcja do sprawdzania czy należy uruchomić tygodniowe usuwanie punktów
 */
async function shouldRunWeeklyRemoval() {
    console.log('\n🔍 ==================== SPRAWDZANIE POTRZEBY USUWANIA ====================');
    
    try {
        const removalData = await readWeeklyRemovalData();
        const lastMondayMidnight = getLastMondayMidnight();
        
        console.log(`📅 Ostatni poniedziałek o północy: ${lastMondayMidnight.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        if (!removalData.lastRemovalTimestamp) {
            console.log('📅 Brak danych o ostatnim usuwaniu - uruchamianie usuwania');
            return true;
        }
        
        const lastRemovalDate = new Date(removalData.lastRemovalTimestamp);
        console.log(`📅 Ostatnie usuwanie: ${lastRemovalDate.toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        if (lastRemovalDate < lastMondayMidnight) {
            console.log('✅ Ostatnie usuwanie było przed ostatnim poniedziałkiem o północy - uruchamianie usuwania');
            return true;
        } else {
            console.log('❌ Ostatnie usuwanie było po ostatnim poniedziałku o północy - nie uruchamiamy');
            return false;
        }
        
    } catch (error) {
        console.error('❌ Błąd podczas sprawdzania potrzeby usuwania:', error);
        return false;
    }
}

/**
 * Funkcja do ustawienia tygodniowego usuwania punktów
 */
async function setupWeeklyRemoval() {
    console.log('\n🗓️ Sprawdzanie tygodniowego usuwania punktów przy starcie...');
    const shouldRun = await shouldRunWeeklyRemoval();
    if (shouldRun) {
        console.log('🚀 Uruchamianie tygodniowego usuwania punktów...');
        const result = await weeklyPointsRemoval();
        if (result.success) {
            console.log(`✅ Tygodniowe usuwanie zakończone: ${result.usersModified} użytkowników, ${result.pointsRemoved} punktów, ${result.rolesModified} ról`);
        } else {
            console.log(`❌ Błąd podczas tygodniowego usuwania: ${result.error}`);
        }
    } else {
        console.log('⏭️ Tygodniowe usuwanie nie jest potrzebne');
    }
    
    console.log('\n⏰ Ustawianie harmonogramu tygodniowego usuwania punktów...');
    
    cron.schedule('0 0 * * 1', async () => {
        console.log('\n🗓️ ==================== ZAPLANOWANE TYGODNIOWE USUWANIE ====================');
        console.log(`📅 Rozpoczęcie o: ${new Date().toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' })}`);
        
        const result = await weeklyPointsRemoval();
        if (result.success) {
            console.log(`✅ Zaplanowane usuwanie zakończone: ${result.usersModified} użytkowników, ${result.pointsRemoved} punktów, ${result.rolesModified} ról`);
        } else {
            console.log(`❌ Błąd podczas zaplanowanego usuwania: ${result.error}`);
        }
    }, {
        timezone: "Europe/Warsaw"
    });
    
    console.log('✅ Harmonogram tygodniowego usuwania ustawiony (poniedziałki o północy - czas polski)');
}

module.exports = {
    readWeeklyRemovalData,
    writeWeeklyRemovalData,
    getLastMondayMidnight,
    getNextMondayMidnight,
    getNextRemovalDate,
    weeklyPointsRemoval,
    shouldRunWeeklyRemoval,
    setupWeeklyRemoval
};
