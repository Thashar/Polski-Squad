const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');
const path = require('path');

class DatabaseService {
    constructor(config) {
        this.config = config;
        this.punishmentsFile = config.database.punishments;
        this.weeklyRemovalFile = config.database.weeklyRemoval;

        // Stare pliki - zachowane dla kompatybilności i migracji
        this.phase1File = path.join(path.dirname(this.punishmentsFile), 'phase1_results.json');
        this.phase2File = path.join(path.dirname(this.punishmentsFile), 'phase2_results.json');

        // Nowa struktura - osobne pliki dla każdego tygodnia
        this.phasesBaseDir = path.join(path.dirname(this.punishmentsFile), 'phases');
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

            if (!(await this.fileExists(this.phase2File))) {
                await this.savePhase2Data({});
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

    // =============== NOWE METODY POMOCNICZE DLA STRUKTURY PLIKÓW ===============

    /**
     * Zwraca ścieżkę do pliku dla konkretnego tygodnia i klanu
     * Przykład: data/phases/guild_123456/phase1/2025/week-40_clan1.json
     */
    getPhaseFilePath(guildId, phase, weekNumber, year, clan) {
        return path.join(
            this.phasesBaseDir,
            `guild_${guildId}`,
            `phase${phase}`,
            year.toString(),
            `week-${weekNumber}_${clan}.json`
        );
    }

    /**
     * Zwraca ścieżkę do katalogu dla konkretnego roku
     * Przykład: data/phases/guild_123456/phase1/2025/
     */
    getPhaseWeekDir(guildId, phase, year) {
        return path.join(
            this.phasesBaseDir,
            `guild_${guildId}`,
            `phase${phase}`,
            year.toString()
        );
    }

    /**
     * Tworzy katalogi jeśli nie istnieją
     */
    async ensurePhaseDirectories(guildId, phase, year) {
        const dir = this.getPhaseWeekDir(guildId, phase, year);
        await fs.mkdir(dir, { recursive: true });
    }

    // =============== KONIEC NOWYCH METOD POMOCNICZYCH ===============

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
     * NOWA WERSJA - sprawdza czy plik istnieje
     */
    async checkPhase1DataExists(guildId, weekNumber, year, clan) {
        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(fileContent);
            return {
                exists: true,
                data: data
            };
        } catch {
            return { exists: false };
        }
    }

    /**
     * Usuwa dane dla danego tygodnia i klanu
     * NOWA WERSJA - usuwa plik
     */
    async deletePhase1DataForWeek(guildId, weekNumber, year, clan) {
        logger.info(`[PHASE1] 🗑️ Usuwanie danych dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);

        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        try {
            await fs.unlink(filePath);
            logger.info(`[PHASE1] ✅ Usunięto dane dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);
            return true;
        } catch (error) {
            logger.warn(`[PHASE1] ⚠️ Nie można usunąć pliku (możliwe że nie istnieje): ${filePath}`);
            return false;
        }
    }

    /**
     * Zapisuje pojedynczy wynik gracza dla danego tygodnia i klanu
     * NOWA WERSJA - zapisuje do osobnego pliku
     */
    async savePhase1Result(guildId, userId, displayName, score, weekNumber, year, clan, createdBy = null) {
        await this.ensurePhaseDirectories(guildId, 1, year);
        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        // Wczytaj istniejące dane lub utwórz nowe
        let weekData;
        let isNewFile = false;
        let isOverwriting = false;

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            weekData = JSON.parse(fileContent);
            isOverwriting = true;
        } catch (error) {
            // Plik nie istnieje - utwórz nową strukturę
            weekData = {
                players: [],
                createdBy: createdBy,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            isNewFile = true;
        }

        // Jeśli nadpisujemy plik, wyświetl informację
        if (isOverwriting && weekData.players.length === 0) {
            logger.warn(`[PHASE1] ⚠️ Nadpisywanie danych dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);
        } else if (isOverwriting) {
            logger.warn(`[PHASE1] ⚠️ Nadpisywanie danych dla tygodnia ${weekNumber}/${year}, klan: ${clan} (poprzednio: ${weekData.players.length} graczy)`);
        }

        // Sprawdź czy gracz już istnieje (aktualizuj jeśli tak)
        const existingPlayerIndex = weekData.players.findIndex(p => p.userId === userId);

        if (existingPlayerIndex !== -1) {
            weekData.players[existingPlayerIndex] = {
                userId,
                displayName,
                score,
                updatedAt: new Date().toISOString()
            };
        } else {
            weekData.players.push({
                userId,
                displayName,
                score,
                createdAt: new Date().toISOString()
            });
        }

        weekData.updatedAt = new Date().toISOString();

        // Zapisz do pliku
        await fs.writeFile(filePath, JSON.stringify(weekData, null, 2), 'utf8');
        logger.info(`[PHASE1] 💾 Zapisano: ${displayName} → ${score} punktów (klan: ${clan}, tydzień: ${weekNumber}/${year})`);
    }

    /**
     * Pobiera podsumowanie danych dla danego tygodnia i klanu
     */
    async getPhase1Summary(guildId, weekNumber, year, clan) {
        // NOWA WERSJA - czyta z osobnego pliku
        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const clanData = JSON.parse(fileContent);
            const players = clanData.players || [];

            const scores = players.map(p => p.score).sort((a, b) => b - a);
            const top30Sum = scores.slice(0, 30).reduce((sum, score) => sum + score, 0);

            return {
                playerCount: players.length,
                top30Sum: top30Sum,
                createdBy: clanData.createdBy,
                createdAt: clanData.createdAt,
                updatedAt: clanData.updatedAt
            };
        } catch (error) {
            // Plik nie istnieje
            return null;
        }
    }

    /**
     * Pobiera wszystkie wyniki dla danego tygodnia i klanu
     * NOWA WERSJA - czyta z osobnego pliku
     */
    async getPhase1Results(guildId, weekNumber, year, clan) {
        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            return JSON.parse(fileContent);
        } catch (error) {
            // Plik nie istnieje
            return null;
        }
    }

    /**
     * Pobiera listę wszystkich tygodni z danymi dla guild
     * NOWA WERSJA - skanuje katalogi zamiast ładować cały plik
     */
    async getAvailableWeeks(guildId) {
        const guildBaseDir = path.join(this.phasesBaseDir, `guild_${guildId}`, 'phase1');

        try {
            // Sprawdź czy katalog guild istnieje
            await fs.access(guildBaseDir);
        } catch {
            return [];
        }

        const weeksMap = new Map(); // weekKey -> { weekNumber, year, clans, createdAt }

        try {
            // Odczytaj wszystkie lata
            const years = await fs.readdir(guildBaseDir);

            for (const yearDir of years) {
                const yearPath = path.join(guildBaseDir, yearDir);
                const stat = await fs.stat(yearPath);

                if (!stat.isDirectory()) continue;

                // Odczytaj wszystkie pliki w danym roku
                const files = await fs.readdir(yearPath);

                for (const filename of files) {
                    // Parsuj nazwę pliku: week-40_clan1.json
                    const match = filename.match(/^week-(\d+)_(.+)\.json$/);
                    if (!match) continue;

                    const weekNumber = parseInt(match[1]);
                    const clan = match[2];
                    const weekKey = `${weekNumber}-${yearDir}`;

                    // Przeczytaj datę utworzenia z pliku
                    const filePath = path.join(yearPath, filename);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const weekData = JSON.parse(fileContent);

                    if (!weeksMap.has(weekKey)) {
                        weeksMap.set(weekKey, {
                            weekNumber,
                            year: parseInt(yearDir),
                            weekKey,
                            clans: [],
                            createdAt: weekData.createdAt
                        });
                    }

                    const weekInfo = weeksMap.get(weekKey);
                    weekInfo.clans.push(clan);

                    // Zachowaj najwcześniejszą datę
                    if (weekData.createdAt < weekInfo.createdAt) {
                        weekInfo.createdAt = weekData.createdAt;
                    }
                }
            }

            // Konwertuj Map na array i sortuj
            const weeks = Array.from(weeksMap.values());
            weeks.sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.weekNumber - a.weekNumber;
            });

            return weeks;

        } catch (error) {
            logger.error('[DB] ❌ Błąd odczytu dostępnych tygodni:', error);
            return [];
        }
    }

    // =============== PHASE 2 METHODS ===============

    async loadPhase2Data() {
        try {
            const data = await fs.readFile(this.phase2File, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            logger.error('💥 Błąd wczytywania danych Fazy 2:', error);
            return {};
        }
    }

    async savePhase2Data(data) {
        try {
            await fs.writeFile(this.phase2File, JSON.stringify(data, null, 2), 'utf8');
        } catch (error) {
            logger.error('💥 Błąd zapisywania danych Fazy 2:', error);
        }
    }

    /**
     * Sprawdza czy dane Phase 2 istnieją
     * NOWA WERSJA - sprawdza czy plik istnieje
     */
    async checkPhase2DataExists(guildId, weekNumber, year, clan) {
        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const data = JSON.parse(fileContent);
            return {
                exists: true,
                data: data
            };
        } catch {
            return { exists: false };
        }
    }

    /**
     * Usuwa dane Phase 2 dla danego tygodnia i klanu
     * NOWA WERSJA - usuwa plik
     */
    async deletePhase2DataForWeek(guildId, weekNumber, year, clan) {
        logger.info(`[PHASE2] 🗑️ Usuwanie danych dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);

        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        try {
            await fs.unlink(filePath);
            logger.info(`[PHASE2] ✅ Usunięto dane dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);
            return true;
        } catch (error) {
            logger.warn(`[PHASE2] ⚠️ Nie można usunąć pliku (możliwe że nie istnieje): ${filePath}`);
            return false;
        }
    }

    /**
     * Zapisuje kompletne wyniki Phase 2 (3 rundy + podsumowanie)
     * NOWA WERSJA - zapisuje do osobnego pliku
     */
    async savePhase2Results(guildId, weekNumber, year, clan, roundsData, summaryPlayers, createdBy) {
        await this.ensurePhaseDirectories(guildId, 2, year);
        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        // Sprawdź czy plik już istnieje
        let isOverwriting = false;
        try {
            await fs.access(filePath);
            isOverwriting = true;
            logger.warn(`[PHASE2] ⚠️ Nadpisywanie danych dla tygodnia ${weekNumber}/${year}, klan: ${clan}`);
        } catch (error) {
            // Plik nie istnieje - to jest nowy zapis
        }

        const weekData = {
            rounds: roundsData,
            summary: {
                players: summaryPlayers
            },
            createdBy: createdBy,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await fs.writeFile(filePath, JSON.stringify(weekData, null, 2), 'utf8');
        logger.info(`[PHASE2] 💾 Zapisano dane dla ${summaryPlayers.length} graczy (3 rundy + suma, klan: ${clan}, tydzień: ${weekNumber}/${year})`);
    }

    async savePhase2Result(guildId, userId, displayName, score, weekNumber, year, clan) {
        const data = await this.loadPhase2Data();
        const weekKey = `${weekNumber}-${year}`;

        if (!data[guildId]) {
            data[guildId] = {};
        }

        if (!data[guildId][weekKey]) {
            data[guildId][weekKey] = {};
        }

        if (!data[guildId][weekKey][clan]) {
            data[guildId][weekKey][clan] = {
                players: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
        }

        const existingPlayerIndex = data[guildId][weekKey][clan].players.findIndex(p => p.userId === userId);

        if (existingPlayerIndex !== -1) {
            data[guildId][weekKey][clan].players[existingPlayerIndex] = {
                userId,
                displayName,
                score,
                updatedAt: new Date().toISOString()
            };
        } else {
            data[guildId][weekKey][clan].players.push({
                userId,
                displayName,
                score,
                createdAt: new Date().toISOString()
            });
        }

        data[guildId][weekKey][clan].updatedAt = new Date().toISOString();

        await this.savePhase2Data(data);
        logger.info(`[PHASE2] 💾 Zapisano: ${displayName} → ${score} punktów (klan: ${clan})`);
    }

    async getPhase2Summary(guildId, weekNumber, year, clan) {
        // NOWA WERSJA - czyta z osobnego pliku
        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const clanData = JSON.parse(fileContent);
            const players = clanData.summary?.players || clanData.players || [];

            const scores = players.map(p => p.score).sort((a, b) => b - a);
            const top30Sum = scores.slice(0, 30).reduce((sum, score) => sum + score, 0);

            return {
                playerCount: players.length,
                top30Sum: top30Sum,
                createdBy: clanData.createdBy,
                createdAt: clanData.createdAt,
                updatedAt: clanData.updatedAt
            };
        } catch (error) {
            // Plik nie istnieje
            return null;
        }
    }

    /**
     * Pobiera wyniki Phase 2 dla danego tygodnia i klanu
     * NOWA WERSJA - czyta z osobnego pliku
     */
    async getPhase2Results(guildId, weekNumber, year, clan) {
        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            return JSON.parse(fileContent);
        } catch (error) {
            // Plik nie istnieje
            return null;
        }
    }

    /**
     * Pobiera listę wszystkich tygodni Phase 2
     * NOWA WERSJA - skanuje katalogi
     */
    async getAvailableWeeksPhase2(guildId) {
        const guildBaseDir = path.join(this.phasesBaseDir, `guild_${guildId}`, 'phase2');

        try {
            await fs.access(guildBaseDir);
        } catch {
            return [];
        }

        const weeksMap = new Map();

        try {
            const years = await fs.readdir(guildBaseDir);

            for (const yearDir of years) {
                const yearPath = path.join(guildBaseDir, yearDir);
                const stat = await fs.stat(yearPath);

                if (!stat.isDirectory()) continue;

                const files = await fs.readdir(yearPath);

                for (const filename of files) {
                    const match = filename.match(/^week-(\d+)_(.+)\.json$/);
                    if (!match) continue;

                    const weekNumber = parseInt(match[1]);
                    const clan = match[2];
                    const weekKey = `${weekNumber}-${yearDir}`;

                    const filePath = path.join(yearPath, filename);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const weekData = JSON.parse(fileContent);

                    if (!weeksMap.has(weekKey)) {
                        weeksMap.set(weekKey, {
                            weekNumber,
                            year: parseInt(yearDir),
                            weekKey,
                            clans: [],
                            createdAt: weekData.createdAt
                        });
                    }

                    const weekInfo = weeksMap.get(weekKey);
                    weekInfo.clans.push(clan);

                    if (weekData.createdAt < weekInfo.createdAt) {
                        weekInfo.createdAt = weekData.createdAt;
                    }
                }
            }

            const weeks = Array.from(weeksMap.values());
            weeks.sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.weekNumber - a.weekNumber;
            });

            return weeks;

        } catch (error) {
            logger.error('[DB] ❌ Błąd odczytu dostępnych tygodni Phase2:', error);
            return [];
        }
    }

    // =============== MIGRACJA DANYCH ===============

    /**
     * Migruje dane ze starych plików (phase1_results.json, phase2_results.json)
     * do nowej struktury (osobne pliki dla każdego tygodnia)
     */
    async migrateToSplitFiles() {
        logger.info('[MIGRATION] 🚀 Rozpoczynam migrację danych do nowej struktury...');

        let phase1Count = 0;
        let phase2Count = 0;
        let errors = 0;

        try {
            // === MIGRACJA PHASE 1 ===
            logger.info('[MIGRATION] 📦 Migracja Phase 1...');

            if (await this.fileExists(this.phase1File)) {
                const phase1Data = await this.loadPhase1Data();

                for (const [guildId, guildData] of Object.entries(phase1Data)) {
                    for (const [weekKey, weekData] of Object.entries(guildData)) {
                        const [weekNumber, year] = weekKey.split('-');

                        for (const [clan, clanData] of Object.entries(weekData)) {
                            try {
                                // Utwórz katalogi
                                await this.ensurePhaseDirectories(guildId, 1, parseInt(year));

                                // Zapisz do nowego pliku
                                const filePath = this.getPhaseFilePath(guildId, 1, parseInt(weekNumber), parseInt(year), clan);
                                await fs.writeFile(filePath, JSON.stringify(clanData, null, 2), 'utf8');

                                phase1Count++;
                                logger.info(`[MIGRATION] ✅ Phase1: ${guildId}/${weekKey}/${clan}`);
                            } catch (error) {
                                logger.error(`[MIGRATION] ❌ Błąd migracji Phase1 ${guildId}/${weekKey}/${clan}:`, error);
                                errors++;
                            }
                        }
                    }
                }

                // Utwórz backup starego pliku
                const backupPath = this.phase1File + '.backup';
                await fs.copyFile(this.phase1File, backupPath);
                logger.info(`[MIGRATION] 💾 Utworzono backup: ${backupPath}`);
            } else {
                logger.info('[MIGRATION] ℹ️  Plik phase1_results.json nie istnieje, pomijam');
            }

            // === MIGRACJA PHASE 2 ===
            logger.info('[MIGRATION] 📦 Migracja Phase 2...');

            if (await this.fileExists(this.phase2File)) {
                const phase2Data = await this.loadPhase2Data();

                for (const [guildId, guildData] of Object.entries(phase2Data)) {
                    for (const [weekKey, weekData] of Object.entries(guildData)) {
                        const [weekNumber, year] = weekKey.split('-');

                        for (const [clan, clanData] of Object.entries(weekData)) {
                            try {
                                await this.ensurePhaseDirectories(guildId, 2, parseInt(year));

                                const filePath = this.getPhaseFilePath(guildId, 2, parseInt(weekNumber), parseInt(year), clan);
                                await fs.writeFile(filePath, JSON.stringify(clanData, null, 2), 'utf8');

                                phase2Count++;
                                logger.info(`[MIGRATION] ✅ Phase2: ${guildId}/${weekKey}/${clan}`);
                            } catch (error) {
                                logger.error(`[MIGRATION] ❌ Błąd migracji Phase2 ${guildId}/${weekKey}/${clan}:`, error);
                                errors++;
                            }
                        }
                    }
                }

                // Utwórz backup starego pliku
                const backupPath = this.phase2File + '.backup';
                await fs.copyFile(this.phase2File, backupPath);
                logger.info(`[MIGRATION] 💾 Utworzono backup: ${backupPath}`);
            } else {
                logger.info('[MIGRATION] ℹ️  Plik phase2_results.json nie istnieje, pomijam');
            }

            // === PODSUMOWANIE ===
            logger.info('[MIGRATION] ');
            logger.info('[MIGRATION] 📊 PODSUMOWANIE MIGRACJI:');
            logger.info(`[MIGRATION] ✅ Phase 1: ${phase1Count} plików`);
            logger.info(`[MIGRATION] ✅ Phase 2: ${phase2Count} plików`);
            logger.info(`[MIGRATION] ❌ Błędy: ${errors}`);
            logger.info('[MIGRATION] ');
            logger.info('[MIGRATION] 🎉 Migracja zakończona!');
            logger.info('[MIGRATION] ℹ️  Stare pliki zachowane jako .backup');
            logger.info('[MIGRATION] ℹ️  Możesz je usunąć po sprawdzeniu że wszystko działa');

            return {
                success: true,
                phase1Count,
                phase2Count,
                errors
            };

        } catch (error) {
            logger.error('[MIGRATION] ❌ Krytyczny błąd migracji:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = DatabaseService;