const fs = require('fs')const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
.promises;
const path = require('path');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.punishmentsFile = config.database.punishments;
        this.weeklyRemovalFile = config.database.weeklyRemoval;
    }

    async initializeDatabase() {
        try {
            logger.info('\n💾 ==================== INICJALIZACJA BAZY DANYCH ====================');
            logger.info('📁 Tworzenie katalogów...');
            
            await fs.mkdir(path.dirname(this.punishmentsFile), { recursive: true });
            await fs.mkdir(path.dirname(this.weeklyRemovalFile), { recursive: true });
            
            if (!(await this.fileExists(this.punishmentsFile))) {
                logger.info('📄 Tworzenie pliku punishments.json...');
                await this.savePunishments({});
            } else {
                logger.info('📄 Plik punishments.json już istnieje');
            }
            
            if (!(await this.fileExists(this.weeklyRemovalFile))) {
                logger.info('📄 Tworzenie pliku weekly_removal.json...');
                await this.saveWeeklyRemoval({});
            } else {
                logger.info('📄 Plik weekly_removal.json już istnieje');
            }
            
            logger.info('✅ Baza danych została pomyślnie zainicjalizowana');
        } catch (error) {
            logger.error('\n💥 ==================== BŁĄD INICJALIZACJI BAZY ====================');
            logger.error('❌ Błąd inicjalizacji bazy danych:', error);
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
            logger.error('💥 Błąd wczytywania bazy kar:', error);
            return {};
        }
    }

    async savePunishments(data) {
        try {
            await fs.writeFile(this.punishmentsFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            logger.error('💥 Błąd zapisywania bazy kar:', error);
        }
    }

    async loadWeeklyRemoval() {
        try {
            const data = await fs.readFile(this.weeklyRemovalFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('💥 Błąd wczytywania danych tygodniowych:', error);
            return {};
        }
    }

    async saveWeeklyRemoval(data) {
        try {
            await fs.writeFile(this.weeklyRemovalFile, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            logger.error('💥 Błąd zapisywania danych tygodniowych:', error);
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
        logger.info(`\n💾 Dodawanie punktów w bazie JSON...`);
        logger.info(`👤 Użytkownik: ${userId}`);
        logger.info(`🎭 Dodawane punkty: ${points}`);
        logger.info(`🏰 Serwer: ${guildId}`);
        logger.info(`📝 Powód: ${reason}`);
        
        const punishments = await this.loadPunishments();
        
        if (!punishments[guildId]) {
            logger.info('🏗️ Tworzenie nowego serwera w bazie...');
            punishments[guildId] = {};
        }
        
        if (!punishments[guildId][userId]) {
            logger.info('👤 Tworzenie nowego użytkownika w bazie...');
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
        
        logger.info(`📊 Punkty: ${oldPoints} -> ${newPoints}`);
        
        await this.savePunishments(punishments);
        logger.info('✅ Pomyślnie zapisano zmiany w bazie');
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
        logger.info('\n🗓️ ==================== TYGODNIOWE USUWANIE PUNKTÓW ====================');
        
        const punishments = await this.loadPunishments();
        const weeklyRemoval = await this.loadWeeklyRemoval();
        
        const now = new Date();
        const weekKey = `${now.getFullYear()}-W${this.getWeekNumber(now)}`;
        
        logger.info(`📅 Sprawdzanie tygodnia: ${weekKey}`);
        
        if (weeklyRemoval[weekKey]) {
            logger.info('⏭️ Punkty już zostały usunięte w tym tygodniu');
            return;
        }
        
        let totalCleaned = 0;
        let guildsProcessed = 0;
        
        logger.info('🔄 Rozpoczynam czyszczenie punktów...');
        
        for (const guildId in punishments) {
            logger.info(`\n🏰 Przetwarzanie serwera: ${guildId}`);
            let usersInGuild = 0;
            
            for (const userId in punishments[guildId]) {
                const oldPoints = punishments[guildId][userId].points;
                punishments[guildId][userId].points = 0;
                punishments[guildId][userId].history.push({
                    points: 0,
                    reason: 'Automatyczne tygodniowe czyszczenie',
                    date: now.toISOString()
                });
                logger.info(`➖ Użytkownik ${userId}: usunięto ${oldPoints} punktów`);
                totalCleaned++;
                usersInGuild++;
            }
            
            logger.info(`✅ Serwer ${guildId}: ${usersInGuild} użytkowników wyczyszczonych`);
            guildsProcessed++;
        }
        
        weeklyRemoval[weekKey] = {
            date: now.toISOString(),
            cleanedUsers: totalCleaned
        };
        
        await this.savePunishments(punishments);
        await this.saveWeeklyRemoval(weeklyRemoval);
        
        logger.info('\n📊 PODSUMOWANIE TYGODNIOWEGO USUWANIA:');
        logger.info(`🏰 Serwerów przetworzonych: ${guildsProcessed}`);
        logger.info(`👥 Użytkowników wyczyszczonych: ${totalCleaned}`);
        logger.info(`📅 Tydzień: ${weekKey}`);
        logger.info('✅ Tygodniowe czyszczenie zakończone pomyślnie');
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