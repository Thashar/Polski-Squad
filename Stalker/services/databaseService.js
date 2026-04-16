const fs = require('fs').promises;
const { createBotLogger } = require('../../utils/consoleLogger');
const { safeParse } = require('../../utils/safeJSON');
const { sync: appSync, eventId, isoWeekStartUTC } = require('../../utils/appSync');

const logger = createBotLogger('Stalker');
const path = require('path');

function classifyPunishmentReason(reason, defaultKind = 'MANUAL') {
    if (!reason) return { kind: defaultKind, note: null };
    const r = String(reason).toLowerCase();
    if (r.includes('niepokonanie')) return { kind: 'BOSS_FAIL', note: reason };
    if (r.includes('tygodniowe')) return { kind: 'WEEKLY_RESET', note: reason };
    if (r.includes('ręczne')) return { kind: 'MANUAL_REMOVAL', note: reason };
    return { kind: defaultKind, note: reason };
}

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

        // Cache dla indeksów graczy (zapobiega wielokrotnym odczytom podczas autocomplete)
        this.playerIndexCache = new Map();
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
     * Zwraca ścieżkę do pliku indeksu graczy
     * Przykład: data/phases/guild_123456/player_index.json
     */
    getPlayerIndexPath(guildId) {
        return path.join(
            this.phasesBaseDir,
            `guild_${guildId}`,
            'player_index.json'
        );
    }

    /**
     * Tworzy katalogi jeśli nie istnieją
     */
    async ensurePhaseDirectories(guildId, phase, year) {
        const dir = this.getPhaseWeekDir(guildId, phase, year);
        await fs.mkdir(dir, { recursive: true });
    }

    /**
     * Ładuje indeks graczy dla danego serwera
     * Struktura: { userId: { latestNick, lastSeen, allNicks[] } }
     * Jeśli indeks nie istnieje, automatycznie go buduje z istniejących danych
     * Używa cache aby uniknąć wielokrotnych odczytów (ważne dla autocomplete - limit 3s)
     */
    async loadPlayerIndex(guildId) {
        // Sprawdź cache
        if (this.playerIndexCache.has(guildId)) {
            return this.playerIndexCache.get(guildId);
        }

        const indexPath = this.getPlayerIndexPath(guildId);
        try {
            const data = await fs.readFile(indexPath, 'utf8');
            const index = safeParse(data, {});
            // Zapisz w cache
            this.playerIndexCache.set(guildId, index);
            return index;
        } catch (error) {
            // Plik nie istnieje - zbuduj indeks automatycznie z istniejących danych
            logger.info(`[INDEX] 📂 Indeks nie istnieje dla guild ${guildId}, budowanie automatycznie...`);
            const result = await this.rebuildPlayerIndex(guildId);

            if (result.success) {
                logger.info(`[INDEX] ✅ Indeks zbudowany automatycznie (${result.playerCount} graczy, ${result.filesScanned} plików)`);
                // Wczytaj świeżo zbudowany indeks
                try {
                    const data = await fs.readFile(indexPath, 'utf8');
                    const index = safeParse(data, {});
                    // Zapisz w cache
                    this.playerIndexCache.set(guildId, index);
                    return index;
                } catch (err) {
                    return {};
                }
            } else {
                logger.error(`[INDEX] ❌ Nie udało się zbudować indeksu: ${result.error}`);
                return {};
            }
        }
    }

    /**
     * Zapisuje indeks graczy dla danego serwera
     * Aktualizuje również cache
     */
    async savePlayerIndex(guildId, index) {
        const indexPath = this.getPlayerIndexPath(guildId);
        const indexDir = path.dirname(indexPath);

        // Upewnij się że katalog istnieje
        await fs.mkdir(indexDir, { recursive: true });

        await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf8');
        
        // Aktualizuj cache
        this.playerIndexCache.set(guildId, index);
    }

    /**
     * Czyści cache indeksu graczy dla danego serwera (lub wszystkich serwerów)
     * Przydatne po manualnej modyfikacji plików lub w testach
     */
    clearPlayerIndexCache(guildId = null) {
        if (guildId) {
            this.playerIndexCache.delete(guildId);
            logger.info(`[INDEX] 🗑️ Cache wyczyszczony dla guild ${guildId}`);
        } else {
            this.playerIndexCache.clear();
            logger.info(`[INDEX] 🗑️ Cache wyczyszczony dla wszystkich guild`);
        }
    }

    /**
     * Aktualizuje indeks gracza po zapisaniu nowych danych
     * Zbiera wszystkie nicki jakie użytkownik miał (bez modyfikacji historycznych danych)
     */
    async updatePlayerIndex(guildId, userId, displayName, timestamp = new Date().toISOString()) {
        const index = await this.loadPlayerIndex(guildId);

        // Sprawdź czy to nowy gracz lub nick się zmienił
        if (!index[userId]) {
            // Nowy gracz
            index[userId] = {
                latestNick: displayName,
                lastSeen: timestamp,
                allNicks: [displayName]
            };
            logger.info(`[INDEX] ➕ Nowy gracz: ${displayName} (${userId})`);
        } else if (index[userId].latestNick !== displayName) {
            // Nick się zmienił - dodaj do listy nicków
            const oldNick = index[userId].latestNick;
            logger.info(`[INDEX] 🔄 Zmiana nicku: "${oldNick}" → "${displayName}" (${userId})`);

            // Aktualizuj indeks
            index[userId].latestNick = displayName;
            index[userId].lastSeen = timestamp;

            // Dodaj do listy wszystkich nicków jeśli jeszcze nie ma
            if (!index[userId].allNicks.includes(displayName)) {
                index[userId].allNicks.push(displayName);
            }
        } else {
            // Ten sam nick - tylko aktualizuj lastSeen
            index[userId].lastSeen = timestamp;
        }

        await this.savePlayerIndex(guildId, index);

        appSync.playerIdentity({
            discordId: userId,
            guildId,
            currentNick: displayName,
            lastSeenAt: timestamp,
        });
        appSync.nickObservation({
            discordId: userId,
            nick: displayName,
            observedAt: timestamp,
        });
    }

    /**
     * Znajduje userId dla danego nicku (może być stary lub nowy nick)
     * Zwraca { userId, latestNick } lub null jeśli nie znaleziono
     */
    async findUserIdByNick(guildId, searchNick) {
        const index = await this.loadPlayerIndex(guildId);
        const searchNickLower = searchNick.toLowerCase();

        // Szukaj w indeksie
        for (const [userId, data] of Object.entries(index)) {
            // Sprawdź czy to aktualny nick
            if (data.latestNick.toLowerCase() === searchNickLower) {
                return { userId, latestNick: data.latestNick };
            }

            // Sprawdź czy to jeden z historycznych nicków
            if (data.allNicks && data.allNicks.some(nick => nick.toLowerCase() === searchNickLower)) {
                return { userId, latestNick: data.latestNick };
            }
        }

        return null;
    }

    /**
     * Przebudowuje indeks graczy od zera na podstawie wszystkich plików phase1
     * Przydatne do migracji istniejących danych
     */
    async rebuildPlayerIndex(guildId) {
        logger.info(`[REBUILD] 🔄 Rozpoczynam przebudowę indeksu graczy dla guild ${guildId}`);

        const guildBaseDir = path.join(this.phasesBaseDir, `guild_${guildId}`, 'phase1');

        try {
            await fs.access(guildBaseDir);
        } catch {
            logger.info(`[REBUILD] ⚠️ Katalog phase1 nie istnieje, tworzę pusty indeks`);
            await this.savePlayerIndex(guildId, {});
            return { success: true, playerCount: 0, filesScanned: 0 };
        }

        // Mapa: userId -> { nicks: Set, lastSeen: timestamp, weekNumber, year }
        const playerData = new Map();
        let filesScanned = 0;

        try {
            // Odczytaj wszystkie lata
            const years = await fs.readdir(guildBaseDir);

            for (const yearDir of years) {
                const yearPath = path.join(guildBaseDir, yearDir);
                const stat = await fs.stat(yearPath);

                if (!stat.isDirectory()) continue;

                const year = parseInt(yearDir);

                // Odczytaj wszystkie pliki w danym roku
                const files = await fs.readdir(yearPath);

                for (const filename of files) {
                    // Parsuj nazwę pliku: week-40_clan1.json
                    const match = filename.match(/^week-(\d+)_(.+)\.json$/);
                    if (!match) continue;

                    const weekNumber = parseInt(match[1]);
                    const filePath = path.join(yearPath, filename);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const weekData = safeParse(fileContent, {});

                    if (!weekData.players) continue;

                    filesScanned++;

                    // Zbierz dane z tego pliku
                    for (const player of weekData.players) {
                        if (!player.userId || !player.displayName) continue;

                        const userId = player.userId;
                        const displayName = player.displayName;
                        const timestamp = weekData.updatedAt || weekData.createdAt || new Date().toISOString();

                        if (!playerData.has(userId)) {
                            playerData.set(userId, {
                                nicks: new Set([displayName]),
                                lastSeen: timestamp,
                                weekNumber: weekNumber,
                                year: year,
                                latestNick: displayName
                            });
                        } else {
                            const data = playerData.get(userId);
                            data.nicks.add(displayName);

                            // Sprawdź czy ten wpis jest nowszy (większy rok lub większy tydzień)
                            const isNewer = (year > data.year) || (year === data.year && weekNumber > data.weekNumber);

                            if (isNewer) {
                                data.lastSeen = timestamp;
                                data.weekNumber = weekNumber;
                                data.year = year;
                                data.latestNick = displayName;
                            }
                        }
                    }
                }
            }

            // Stwórz indeks w docelowym formacie
            const index = {};
            for (const [userId, data] of playerData.entries()) {
                index[userId] = {
                    latestNick: data.latestNick,
                    lastSeen: data.lastSeen,
                    allNicks: Array.from(data.nicks)
                };
            }

            // Zapisz indeks
            await this.savePlayerIndex(guildId, index);

            logger.info(`[REBUILD] ✅ Indeks przebudowany pomyślnie:`);
            logger.info(`[REBUILD]    📂 Przeskanowano plików: ${filesScanned}`);
            logger.info(`[REBUILD]    👥 Znaleziono graczy: ${playerData.size}`);

            return {
                success: true,
                playerCount: playerData.size,
                filesScanned: filesScanned
            };

        } catch (error) {
            logger.error('[REBUILD] ❌ Błąd przebudowy indeksu:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // =============== KONIEC NOWYCH METOD POMOCNICZYCH ===============

    async loadPunishments() {
        try {
            const data = await fs.readFile(this.punishmentsFile, 'utf8');
            return safeParse(data, {});
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
            return safeParse(data, {});
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
                lifetime_points: 0,
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
                lifetime_points: 0,
                history: []
            };
        }

        // Zapewnij że lifetime_points istnieje (dla starych rekordów)
        if (!punishments[guildId][userId].lifetime_points) {
            punishments[guildId][userId].lifetime_points = 0;
        }

        const oldPoints = punishments[guildId][userId].points;
        punishments[guildId][userId].points += points;
        const newPoints = punishments[guildId][userId].points;

        // Zwiększ lifetime_points (tylko jeśli dodajemy punkty, nie odejmujemy)
        if (points > 0) {
            punishments[guildId][userId].lifetime_points += points;
        }
        
        punishments[guildId][userId].history.push({
            points: points,
            reason: reason,
            date: new Date().toISOString()
        });
        
        logger.info(`📊 Punkty: ${oldPoints} -> ${newPoints}`);

        await this.savePunishments(punishments);
        logger.info('✅ Pomyślnie zapisano zmiany w bazie');

        const occurredAt = new Date().toISOString();
        const { kind, note } = classifyPunishmentReason(reason, 'BOSS_FAIL');
        appSync.punishmentEvent({
            id: eventId('punish', guildId, userId, occurredAt, points, reason),
            guildId,
            discordId: userId,
            delta: points,
            reasonKind: kind,
            reasonNote: note,
            occurredAt,
        });

        return punishments[guildId][userId];
    }

    async removePunishmentPoints(guildId, userId, points) {
        const punishments = await this.loadPunishments();

        if (!punishments[guildId] || !punishments[guildId][userId]) {
            return null;
        }

        // Zapewnij że lifetime_points istnieje (dla starych rekordów)
        if (!punishments[guildId][userId].lifetime_points) {
            punishments[guildId][userId].lifetime_points = 0;
        }

        const oldPoints = punishments[guildId][userId].points;
        punishments[guildId][userId].points = Math.max(0, oldPoints - points);

        if (oldPoints > 0 && punishments[guildId][userId].points === 0) {
            // Punkty aktywne spadły do 0 — zeruj też lifetime (czyste konto)
            punishments[guildId][userId].lifetime_points = 0;
        } else {
            // Points już były 0 lub nadal > 0 — odejmuj proporcjonalnie tylko od lifetime
            punishments[guildId][userId].lifetime_points = Math.max(0, punishments[guildId][userId].lifetime_points - points);
        }

        punishments[guildId][userId].history.push({
            points: -points,
            reason: 'Ręczne usunięcie punktów',
            date: new Date().toISOString()
        });

        // Usuń użytkownika TYLKO jeśli ma 0 punktów i 0 lifetime_points
        const userRecord = punishments[guildId][userId];
        if (userRecord.points === 0 && userRecord.lifetime_points === 0) {
            delete punishments[guildId][userId];
        }

        await this.savePunishments(punishments);

        const occurredAt = new Date().toISOString();
        appSync.punishmentEvent({
            id: eventId('unpunish', guildId, userId, occurredAt, points),
            guildId,
            discordId: userId,
            delta: -Math.abs(points),
            reasonKind: 'MANUAL_REMOVAL',
            reasonNote: 'Ręczne usunięcie punktów',
            occurredAt,
        });

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
        const cleanedEvents = [];
        logger.info('🔄 Rozpoczynam czyszczenie punktów...');
        for (const guildId in punishments) {
            logger.info(`Przetwarzanie serwera: ${guildId}`);
            let usersInGuild = 0;
            for (const userId in punishments[guildId]) {
                // Zapewnij że lifetime_points istnieje (dla starych rekordów)
                if (!punishments[guildId][userId].lifetime_points) {
                    punishments[guildId][userId].lifetime_points = 0;
                }

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
                    cleanedEvents.push({ guildId, userId, delta: newPoints - oldPoints });

                    // Usuń użytkownika TYLKO jeśli ma 0 punktów i 0 lifetime_points (stary rekord)
                    if (newPoints === 0 && (!punishments[guildId][userId].lifetime_points || punishments[guildId][userId].lifetime_points === 0)) {
                        delete punishments[guildId][userId];
                        logger.info(`🗑️ Użytkownik ${userId}: usunięty z bazy (0 punktów, 0 lifetime_points)`);
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

        const occurredAt = now.toISOString();
        for (const { guildId, userId, delta } of cleanedEvents) {
            appSync.punishmentEvent({
                id: eventId('weekly_reset', guildId, userId, occurredAt, delta),
                guildId,
                discordId: userId,
                delta,
                reasonKind: 'WEEKLY_RESET',
                reasonNote: 'Automatyczne tygodniowe usuwanie punktu',
                occurredAt,
            });
        }
        
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
            return safeParse(data, {});
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
            const data = safeParse(fileContent, {});
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
            weekData = safeParse(fileContent, {});
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

        // Aktualizuj indeks graczy (normalizuje nicki jeśli się zmienił)
        // Wewnętrznie pushuje też playerIdentity + nickObservation do web API.
        await this.updatePlayerIndex(guildId, userId, displayName, weekData.updatedAt);

        appSync.phaseResult({
            guildId,
            discordId: userId,
            phase: 'PHASE_1',
            year,
            weekNumber,
            weekStartsAt: isoWeekStartUTC(year, weekNumber),
            clan,
            score,
            displayNameAtTime: displayName,
            recordedAt: weekData.updatedAt,
            recordedBy: createdBy || null,
        });
    }

    /**
     * Pobiera podsumowanie danych dla danego tygodnia i klanu
     */
    async getPhase1Summary(guildId, weekNumber, year, clan) {
        // NOWA WERSJA - czyta z osobnego pliku
        const filePath = this.getPhaseFilePath(guildId, 1, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const clanData = safeParse(fileContent, {});
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
            return safeParse(fileContent, {});
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
                    const weekData = safeParse(fileContent, {});

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

    /**
     * Pobiera najwyższy historyczny wynik gracza przed określonym tygodniem
     * Przeszukuje wszystkie klany z danego serwera
     * @param {string} guildId - ID serwera
     * @param {string} userId - ID użytkownika
     * @param {number} beforeWeekNumber - Numer tygodnia (wyłącznie, nie włączamy tego tygodnia)
     * @param {number} beforeYear - Rok tygodnia
     * @param {string} clan - Klan (parametr zachowany dla kompatybilności, ale nie jest używany)
     * @returns {number|null} - Najwyższy wynik lub null jeśli nie znaleziono
     */
    async getPlayerHistoricalBestScore(guildId, userId, beforeWeekNumber, beforeYear, clan) {
        const guildBaseDir = path.join(this.phasesBaseDir, `guild_${guildId}`, 'phase1');

        try {
            await fs.access(guildBaseDir);
        } catch {
            return null;
        }

        let bestScore = null;

        try {
            // Odczytaj wszystkie lata
            const years = await fs.readdir(guildBaseDir);

            for (const yearDir of years) {
                const year = parseInt(yearDir);
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

                    // Sprawdź czy ten tydzień jest PRZED określonym tygodniem
                    const isBeforeTarget = (year < beforeYear) ||
                                          (year === beforeYear && weekNumber < beforeWeekNumber);

                    if (!isBeforeTarget) continue;

                    // Przeczytaj plik i znajdź wynik gracza
                    const filePath = path.join(yearPath, filename);
                    const fileContent = await fs.readFile(filePath, 'utf8');
                    const weekData = safeParse(fileContent, {});

                    if (!weekData.players) continue;

                    // Znajdź gracza w tym tygodniu
                    const player = weekData.players.find(p => p.userId === userId);
                    if (player && player.score !== undefined) {
                        if (bestScore === null || player.score > bestScore) {
                            bestScore = player.score;
                        }
                    }
                }
            }

            return bestScore;

        } catch (error) {
            logger.error('[DB] ❌ Błąd odczytu historycznego najwyższego wyniku:', error);
            return null;
        }
    }

    // =============== PHASE 2 METHODS ===============

    async loadPhase2Data() {
        try {
            const data = await fs.readFile(this.phase2File, 'utf8');
            return safeParse(data, {});
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
            const data = safeParse(fileContent, {});
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

        const now = weekData.updatedAt;
        const weekStartsAt = isoWeekStartUTC(year, weekNumber);
        for (const player of summaryPlayers || []) {
            appSync.phaseResult({
                guildId,
                discordId: player.userId,
                phase: 'PHASE_2',
                year,
                weekNumber,
                weekStartsAt,
                clan,
                score: player.score,
                displayNameAtTime: player.displayName,
                recordedAt: now,
                recordedBy: createdBy || null,
            });
            appSync.playerIdentity({
                discordId: player.userId,
                guildId,
                currentNick: player.displayName,
                lastSeenAt: now,
            });
            appSync.nickObservation({
                discordId: player.userId,
                nick: player.displayName,
                observedAt: now,
            });
        }
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

        const now = new Date().toISOString();
        data[guildId][weekKey][clan].updatedAt = now;

        await this.savePhase2Data(data);
        logger.info(`[PHASE2] 💾 Zapisano: ${displayName} → ${score} punktów (klan: ${clan})`);

        appSync.phaseResult({
            guildId,
            discordId: userId,
            phase: 'PHASE_2',
            year,
            weekNumber,
            weekStartsAt: isoWeekStartUTC(year, weekNumber),
            clan,
            score,
            displayNameAtTime: displayName,
            recordedAt: now,
            recordedBy: null,
        });
        appSync.playerIdentity({
            discordId: userId,
            guildId,
            currentNick: displayName,
            lastSeenAt: now,
        });
        appSync.nickObservation({
            discordId: userId,
            nick: displayName,
            observedAt: now,
        });
    }

    async getPhase2Summary(guildId, weekNumber, year, clan) {
        // NOWA WERSJA - czyta z osobnego pliku
        const filePath = this.getPhaseFilePath(guildId, 2, weekNumber, year, clan);

        try {
            const fileContent = await fs.readFile(filePath, 'utf8');
            const clanData = safeParse(fileContent, {});
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
            return safeParse(fileContent, {});
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
                    const weekData = safeParse(fileContent, {});

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