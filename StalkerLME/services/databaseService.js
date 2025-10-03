const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
const path = require('path');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.punishmentsFile = config.database.punishments;
        this.weeklyRemovalFile = config.database.weeklyRemoval;
        this.phase1File = path.join(path.dirname(this.punishmentsFile), 'phase1_results.json');
    }

    async initializeDatabase() {
        try {
            await fs.mkdir(path.dirname(this.punishmentsFile), { recursive: true });
            await fs.mkdir(path.dirname(this.weeklyRemovalFile), { recursive: true });

            if (!(await this.fileExists(this.punishmentsFile))) {
                await this.savePunishments({});
            }

            if (!(await this.fileExists(this.weeklyRemovalFile))) {
                await this.saveWeeklyRemoval({});
            }

            if (!(await this.fileExists(this.phase1File))) {
                await this.savePhase1Data({});
            }
        } catch (error) {
            logger.error('Błąd inicjalizacji bazy');
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
        logger.info('Dodawanie punktów w bazie JSON...');
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
        logger.info('Tygodniowe usuwanie punktów');
        
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
            logger.info(`Przetwarzanie serwera: ${guildId}`);
            let usersInGuild = 0;
            
            for (const userId in punishments[guildId]) {
                const oldPoints = punishments[guildId][userId].points;
                if (oldPoints > 0) {
                    punishments[guildId][userId].points = Math.max(0, oldPoints - 1);
                    const newPoints = punishments[guildId][userId].points;
                    punishments[guildId][userId].history.push({
                        points: -1,
                        reason: 'Automatyczne tygodniowe usuwanie 1 punktu',
                        date: now.toISOString()
                    });
                    logger.info(`➖ Użytkownik ${userId}: ${oldPoints} -> ${newPoints} punktów (usunięto 1)`);
                    totalCleaned++;
                    usersInGuild++;
                    
                    // Jeśli użytkownik ma teraz 0 punktów, usuń go z bazy
                    if (newPoints === 0) {
                        delete punishments[guildId][userId];
                        logger.info(`🗑️ Użytkownik ${userId}: usunięty z bazy (0 punktów)`);
                    }
                } else {
                    logger.info(`⏭️ Użytkownik ${userId}: już ma 0 punktów, pomijam`);
                }
            }
            
            logger.info(`✅ Serwer ${guildId}: ${usersInGuild} użytkowników przetworzonych`);
            guildsProcessed++;
        }
        
        weeklyRemoval[weekKey] = {
            date: now.toISOString(),
            cleanedUsers: totalCleaned
        };
        
        await this.savePunishments(punishments);
        await this.saveWeeklyRemoval(weeklyRemoval);
        
        logger.info('Podsumowanie tygodniowego usuwania:');
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

    // =============== PHASE 1 METHODS ===============

    async loadPhase1Data() {
        try {
            const data = await fs.readFile(this.phase1File, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('💥 Błąd wczytywania danych Fazy 1:', error);
            return {};
        }
    }

    async savePhase1Data(data) {
        try {
            await fs.writeFile(this.phase1File, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            logger.error('💥 Błąd zapisywania danych Fazy 1:', error);
        }
    }

    /**
     * Sprawdza czy dane dla danego tygodnia już istnieją
     * Struktura: { guildId: { "weekNumber-year": { players: [...], createdAt, updatedAt } } }
     */
    async checkPhase1DataExists(guildId, weekNumber, year) {
        const data = await this.loadPhase1Data();
        const weekKey = `${weekNumber}-${year}`;

        if (data[guildId] && data[guildId][weekKey]) {
            return {
                exists: true,
                data: data[guildId][weekKey]
            };
        }

        return { exists: false };
    }

    /**
     * Usuwa dane dla danego tygodnia
     */
    async deletePhase1DataForWeek(guildId, weekNumber, year) {
        logger.info(`[PHASE1] 🗑️ Usuwanie danych dla tygodnia ${weekNumber}/${year}`);

        const data = await this.loadPhase1Data();
        const weekKey = `${weekNumber}-${year}`;

        if (data[guildId] && data[guildId][weekKey]) {
            delete data[guildId][weekKey];
            await this.savePhase1Data(data);
            logger.info(`[PHASE1] ✅ Usunięto dane dla tygodnia ${weekNumber}/${year}`);
            return true;
        }

        return false;
    }

    /**
     * Zapisuje pojedynczy wynik gracza dla danego tygodnia
     */
    async savePhase1Result(guildId, userId, displayName, score, weekNumber, year) {
        const data = await this.loadPhase1Data();
        const weekKey = `${weekNumber}-${year}`;

        if (!data[guildId]) {
            data[guildId] = {};
        }

        if (!data[guildId][weekKey]) {
            data[guildId][weekKey] = {
                players: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        }

        // Sprawdź czy gracz już istnieje w tym tygodniu (aktualizuj jeśli tak)
        const existingPlayerIndex = data[guildId][weekKey].players.findIndex(p => p.userId === userId);

        if (existingPlayerIndex !== -1) {
            data[guildId][weekKey].players[existingPlayerIndex] = {
                userId,
                displayName,
                score,
                updatedAt: new Date().toISOString()
            };
        } else {
            data[guildId][weekKey].players.push({
                userId,
                displayName,
                score,
                createdAt: new Date().toISOString()
            });
        }

        data[guildId][weekKey].updatedAt = new Date().toISOString();

        await this.savePhase1Data(data);
        logger.info(`[PHASE1] 💾 Zapisano: ${displayName} → ${score} punktów`);
    }

    /**
     * Pobiera podsumowanie danych dla danego tygodnia
     */
    async getPhase1Summary(guildId, weekNumber, year) {
        const data = await this.loadPhase1Data();
        const weekKey = `${weekNumber}-${year}`;

        if (!data[guildId] || !data[guildId][weekKey]) {
            return null;
        }

        const weekData = data[guildId][weekKey];
        const players = weekData.players || [];

        const scores = players.map(p => p.score).sort((a, b) => b - a);
        const top30Sum = scores.slice(0, 30).reduce((sum, score) => sum + score, 0);

        return {
            playerCount: players.length,
            top30Sum: top30Sum,
            createdAt: weekData.createdAt,
            updatedAt: weekData.updatedAt
        };
    }

    /**
     * Pobiera wszystkie wyniki dla danego tygodnia
     */
    async getPhase1Results(guildId, weekNumber, year) {
        const data = await this.loadPhase1Data();
        const weekKey = `${weekNumber}-${year}`;

        if (!data[guildId] || !data[guildId][weekKey]) {
            return null;
        }

        return data[guildId][weekKey];
    }

    /**
     * Pobiera listę wszystkich tygodni z danymi dla guild
     */
    async getAvailableWeeks(guildId) {
        const data = await this.loadPhase1Data();

        if (!data[guildId]) {
            return [];
        }

        const weeks = Object.keys(data[guildId]).map(weekKey => {
            const [weekNumber, year] = weekKey.split('-');
            return {
                weekNumber: parseInt(weekNumber),
                year: parseInt(year),
                weekKey: weekKey,
                createdAt: data[guildId][weekKey].createdAt
            };
        });

        // Sortuj od najnowszego
        weeks.sort((a, b) => {
            if (a.year !== b.year) return b.year - a.year;
            return b.weekNumber - a.weekNumber;
        });

        return weeks;
    }
}

module.exports = DatabaseService;