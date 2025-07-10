const fs = require('fs').promises;
const path = require('path');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.punishmentsFile = config.database.punishments;
        this.weeklyRemovalFile = config.database.weeklyRemoval;
    }

    async initializeDatabase() {
        try {
            console.log('\n💾 ==================== INICJALIZACJA BAZY DANYCH ====================');
            console.log('📁 Tworzenie katalogów...');
            
            await fs.mkdir(path.dirname(this.punishmentsFile), { recursive: true });
            await fs.mkdir(path.dirname(this.weeklyRemovalFile), { recursive: true });
            
            if (!(await this.fileExists(this.punishmentsFile))) {
                console.log('📄 Tworzenie pliku punishments.json...');
                await this.savePunishments({});
            } else {
                console.log('📄 Plik punishments.json już istnieje');
            }
            
            if (!(await this.fileExists(this.weeklyRemovalFile))) {
                console.log('📄 Tworzenie pliku weekly_removal.json...');
                await this.saveWeeklyRemoval({});
            } else {
                console.log('📄 Plik weekly_removal.json już istnieje');
            }
            
            console.log('✅ Baza danych została pomyślnie zainicjalizowana');
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD INICJALIZACJI BAZY ====================');
            console.error('❌ Błąd inicjalizacji bazy danych:', error);
        }
    }

    async fileExists(filePath) {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async loadPunishments() {
        try {
            const data = await fs.readFile(this.punishmentsFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('💥 Błąd wczytywania bazy kar:', error);
            return {};
        }
    }

    async savePunishments(data) {
        try {
            await fs.writeFile(this.punishmentsFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('💥 Błąd zapisywania bazy kar:', error);
        }
    }

    async loadWeeklyRemoval() {
        try {
            const data = await fs.readFile(this.weeklyRemovalFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('💥 Błąd wczytywania danych tygodniowych:', error);
            return {};
        }
    }

    async saveWeeklyRemoval(data) {
        try {
            await fs.writeFile(this.weeklyRemovalFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            console.error('💥 Błąd zapisywania danych tygodniowych:', error);
        }
    }

    async getUserPunishments(guildId, userId) {
        const punishments = await this.loadPunishments();
        
        if (!punishments[guildId]) {
            punishments[guildId] = {};
        }
        
        if (!punishments[guildId][userId]) {
            punishments[guildId][userId] = {
                points: 0,
                history: []
            };
        }
        
        return punishments[guildId][userId];
    }

    async addPunishmentPoints(guildId, userId, points, reason = 'Niepokonanie bossa') {
        console.log(`\n💾 Dodawanie punktów w bazie JSON...`);
        console.log(`👤 Użytkownik: ${userId}`);
        console.log(`🎭 Dodawane punkty: ${points}`);
        console.log(`🏰 Serwer: ${guildId}`);
        console.log(`📝 Powód: ${reason}`);
        
        const punishments = await this.loadPunishments();
        
        if (!punishments[guildId]) {
            console.log('🏗️ Tworzenie nowego serwera w bazie...');
            punishments[guildId] = {};
        }
        
        if (!punishments[guildId][userId]) {
            console.log('👤 Tworzenie nowego użytkownika w bazie...');
            punishments[guildId][userId] = {
                points: 0,
                history: []
            };
        }
        
        const oldPoints = punishments[guildId][userId].points;
        punishments[guildId][userId].points += points;
        const newPoints = punishments[guildId][userId].points;
        
        punishments[guildId][userId].history.push({
            points: points,
            reason: reason,
            date: new Date().toISOString()
        });
        
        console.log(`📊 Punkty: ${oldPoints} -> ${newPoints}`);
        
        await this.savePunishments(punishments);
        console.log('✅ Pomyślnie zapisano zmiany w bazie');
        return punishments[guildId][userId];
    }

    async removePunishmentPoints(guildId, userId, points) {
        const punishments = await this.loadPunishments();
        
        if (!punishments[guildId] || !punishments[guildId][userId]) {
            return null;
        }
        
        punishments[guildId][userId].points = Math.max(0, punishments[guildId][userId].points - points);
        punishments[guildId][userId].history.push({
            points: -points,
            reason: 'Ręczne usunięcie punktów',
            date: new Date().toISOString()
        });
        
        if (punishments[guildId][userId].points === 0) {
            delete punishments[guildId][userId];
        }
        
        await this.savePunishments(punishments);
        return punishments[guildId][userId];
    }

    async deleteUser(guildId, userId) {
        const punishments = await this.loadPunishments();
        
        if (!punishments[guildId] || !punishments[guildId][userId]) {
            return false;
        }
        
        delete punishments[guildId][userId];
        await this.savePunishments(punishments);
        return true;
    }

    async getGuildPunishments(guildId) {
        const punishments = await this.loadPunishments();
        return punishments[guildId] || {};
    }

    async cleanupWeeklyPoints() {
        console.log('\n🗓️ ==================== TYGODNIOWE USUWANIE PUNKTÓW ====================');
        
        const punishments = await this.loadPunishments();
        const weeklyRemoval = await this.loadWeeklyRemoval();
        
        const now = new Date();
        const weekKey = `${now.getFullYear()}-W${this.getWeekNumber(now)}`;
        
        console.log(`📅 Sprawdzanie tygodnia: ${weekKey}`);
        
        if (weeklyRemoval[weekKey]) {
            console.log('⏭️ Punkty już zostały usunięte w tym tygodniu');
            return;
        }
        
        let totalCleaned = 0;
        let guildsProcessed = 0;
        
        console.log('🔄 Rozpoczynam czyszczenie punktów...');
        
        for (const guildId in punishments) {
            console.log(`\n🏰 Przetwarzanie serwera: ${guildId}`);
            let usersInGuild = 0;
            
            for (const userId in punishments[guildId]) {
                const oldPoints = punishments[guildId][userId].points;
                punishments[guildId][userId].points = 0;
                punishments[guildId][userId].history.push({
                    points: 0,
                    reason: 'Automatyczne tygodniowe czyszczenie',
                    date: now.toISOString()
                });
                console.log(`➖ Użytkownik ${userId}: usunięto ${oldPoints} punktów`);
                totalCleaned++;
                usersInGuild++;
            }
            
            console.log(`✅ Serwer ${guildId}: ${usersInGuild} użytkowników wyczyszczonych`);
            guildsProcessed++;
        }
        
        weeklyRemoval[weekKey] = {
            date: now.toISOString(),
            cleanedUsers: totalCleaned
        };
        
        await this.savePunishments(punishments);
        await this.saveWeeklyRemoval(weeklyRemoval);
        
        console.log('\n📊 PODSUMOWANIE TYGODNIOWEGO USUWANIA:');
        console.log(`🏰 Serwerów przetworzonych: ${guildsProcessed}`);
        console.log(`👥 Użytkowników wyczyszczonych: ${totalCleaned}`);
        console.log(`📅 Tydzień: ${weekKey}`);
        console.log('✅ Tygodniowe czyszczenie zakończone pomyślnie');
    }

    getWeekNumber(date) {
        const target = new Date(date.valueOf());
        const dayNr = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }
}

module.exports = DatabaseService;