const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { EmbedBuilder } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Kontroler');

/**
 * Serwis zarządzający systemem loterii
 */
class LotteryService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.activeLotteries = new Map(); // ID -> lottery data
        this.cronJobs = new Map(); // ID -> cron job
        this.sentWarnings = new Map(); // Śledzenie wysłanych ostrzeżeń: "channelType_date_hour" -> timestamp
    }

    /**
     * Inicjalizuje serwis
     */
    async initialize(client) {
        this.client = client;
        
        // Utwórz katalog data jeśli nie istnieje
        await this.ensureDataDirectory();
        
        // Wczytaj istniejące loterie
        await this.loadLotteries();
        
        // Ustaw czyszczenie starych ostrzeżeń co godzinę
        setInterval(() => {
            this.cleanupOldWarnings();
        }, 60 * 60 * 1000); // co godzinę
        
    }

    /**
     * Zapewnia istnienie katalogu danych
     */
    async ensureDataDirectory() {
        try {
            const dataDir = path.dirname(this.config.lottery.dataFile);
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error) {
            logger.error('❌ Błąd tworzenia katalogu danych:', error);
        }
    }

    /**
     * Wczytuje istniejące loterie z pliku
     */
    async loadLotteries() {
        try {
            const data = await fs.readFile(this.config.lottery.dataFile, 'utf8');

            // Obsługa pustych plików (np. gdy brakło miejsca na dysku podczas zapisu)
            if (!data || data.trim() === '') {
                return;
            }

            const lotteryData = JSON.parse(data);
            
            if (lotteryData.activeLotteries) {
                // Przywróć aktywne loterie
                for (const [id, lottery] of Object.entries(lotteryData.activeLotteries)) {
                    // Migracja starych loterii - usuń te ze starą strukturą
                    if (lottery.dayOfWeek && !lottery.firstDrawDate) {
                        logger.warn(`⚠️ Usuwam starą loterię o przestarzałej strukturze: ${id}`);
                        continue; // Pomiń starą loterię
                    }
                    
                    this.activeLotteries.set(id, lottery);
                    
                    try {
                        this.scheduleNextLottery(id, lottery);
                    } catch (error) {
                        logger.error(`❌ Błąd planowania loterii ${id}: ${error.message}`);
                        // Usuń problematyczną loterię
                        this.activeLotteries.delete(id);
                    }
                }
                if (this.activeLotteries.size > 0) {
                    logger.info(`🔄 Przywrócono ${this.activeLotteries.size} aktywnych loterii`);
                }
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error('❌ Błąd wczytywania danych loterii:', error);
            }
            // Utwórz pusty plik
            await this.saveLotteryData();
        }
    }

    /**
     * Zapisuje dane loterii do pliku
     */
    async saveLotteryData() {
        try {
            let existingData = {};
            
            try {
                const data = await fs.readFile(this.config.lottery.dataFile, 'utf8');
                existingData = JSON.parse(data);
            } catch (error) {
                // Plik nie istnieje lub jest uszkodzony - użyj pustej struktury
                logger.warn('⚠️ Nie można wczytać istniejących danych loterii, tworzę nowe');
            }
            
            const dataToSave = {
                ...existingData,
                activeLotteries: Object.fromEntries(this.activeLotteries),
                lastUpdated: new Date().toISOString()
            };
            
            await fs.writeFile(this.config.lottery.dataFile, JSON.stringify(dataToSave, null, 2));
        } catch (error) {
            logger.error('❌ Błąd zapisu danych loterii:', error);
            throw error;
        }
    }

    /**
     * Tworzy nową loterię
     */
    async createLottery(interaction, lotteryData) {
        const {
            targetRole,
            clanKey,
            frequency,
            drawDate,
            hour,
            minute,
            winnersCount,
            channelId
        } = lotteryData;

        const clan = this.config.lottery.clans[clanKey];
        if (!clan) {
            throw new Error(`Nieprawidłowy klucz klanu: ${clanKey}`);
        }

        // Ustaw dokładną datę i czas pierwszego losowania w polskiej strefie czasowej
        // Tworzymy datę w formacie YYYY-MM-DD HH:MM w strefie Europe/Warsaw
        const year = drawDate.getFullYear();
        const month = String(drawDate.getMonth() + 1).padStart(2, '0');
        const day = String(drawDate.getDate()).padStart(2, '0');
        const hourStr = String(hour).padStart(2, '0');
        const minuteStr = String(minute).padStart(2, '0');
        
        // Tworzymy datę w polskiej strefie czasowej
        const dateTimeString = `${year}-${month}-${day}T${hourStr}:${minuteStr}:00`;
        
        // Konwertujemy na UTC uwzględniając polską strefę czasową
        const nextDrawDate = new Date(dateTimeString);
        
        // Sprawdź czy to czas letni (marzec-październik) czy zimowy
        const isWinterTime = this.isWinterTime(nextDrawDate);
        const offsetHours = isWinterTime ? -1 : -2; // Polska to UTC+1 (zimą) lub UTC+2 (latem)
        
        // Skoryguj o różnicę czasową (konwertuj z polskiego czasu na UTC)
        nextDrawDate.setHours(nextDrawDate.getHours() + offsetHours);
        
        const nextDrawTimestamp = nextDrawDate.getTime();
        const formattedDate = nextDrawDate.toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
        const roleShort = targetRole.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 6);
        const clanShort = clanKey.toLowerCase();
        const randomSuffix = Math.random().toString(36).substr(2, 4);
        
        const lotteryId = `${formattedDate}_${roleShort}_${clanShort}_${randomSuffix}`;
        

        const lottery = {
            id: lotteryId,
            name: `Loteria ${targetRole.name} dla ${clan.displayName}`,
            targetRoleId: targetRole.id,
            clanRoleId: clan.roleId, // może być null dla opcji "cały serwer"
            clanKey: clanKey,
            clanType: clanKey, // Dodaj clanType jako alias do clanKey dla kompatybilności
            clanName: clan.name,
            clanDisplayName: clan.displayName,
            frequency: frequency,
            firstDrawDate: drawDate.toISOString().split('T')[0], // Zapisz oryginalną datę w formacie YYYY-MM-DD
            hour: hour,
            minute: minute,
            winnersCount: winnersCount,
            winners: winnersCount, // Dodaj alias dla kompatybilności
            channelId: channelId,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            lastDraw: null,
            nextDraw: nextDrawDate.toISOString()
        };

        // Zapisz loterię
        this.activeLotteries.set(lotteryId, lottery);
        await this.saveLotteryData();

        // Zaplanuj pierwsze losowanie
        this.scheduleNextLottery(lotteryId, lottery);

        logger.info(`🎰 Utworzono loterię: ${lottery.name}`);
        
        return {
            success: true,
            lottery: lottery
        };
    }

    /**
     * Sprawdza czy podana data jest w czasie zimowym (UTC+1) czy letnim (UTC+2) w Polsce
     * @param {Date} date - Data do sprawdzenia
     * @returns {boolean} - true jeśli czas zimowy, false jeśli letni
     */
    isWinterTime(date) {
        const year = date.getFullYear();
        
        // Ostatnia niedziela marca (początek czasu letniego)
        const lastSundayMarch = new Date(year, 2, 31);
        lastSundayMarch.setDate(31 - lastSundayMarch.getDay());
        
        // Ostatnia niedziela października (powrót do czasu zimowego)
        const lastSundayOctober = new Date(year, 9, 31);
        lastSundayOctober.setDate(31 - lastSundayOctober.getDay());
        
        // Jeśli data jest przed ostatnią niedzielą marca lub po ostatniej niedzieli października
        return date < lastSundayMarch || date > lastSundayOctober;
    }

    /**
     * Konwertuje czas UTC na polski czas lokalny dla wyświetlania
     * @param {Date} utcDate - Data w UTC
     * @returns {string} - Sformatowana data w polskim czasie
     */
    convertUTCToPolishTime(utcDate) {
        const isWinter = this.isWinterTime(utcDate);
        const offsetHours = isWinter ? 1 : 2; // Dodajemy offset dla konwersji UTC -> Polski czas
        
        const polishTime = new Date(utcDate.getTime() + offsetHours * 60 * 60 * 1000);
        return polishTime.toLocaleString('pl-PL');
    }

    /**
     * Oblicza następny termin losowania na podstawie bieżącej daty loterii
     * @param {string} currentDrawDate - aktualna data losowania w formacie ISO
     * @param {number} hour - godzina
     * @param {number} minute - minuta
     * @param {boolean} isExecuting - czy funkcja jest wywoływana podczas wykonywania loterii
     * @param {number} frequency - częstotliwość w dniach
     */
    calculateNextDraw(currentDrawDate, hour, minute, isExecuting = false, frequency = 7) {
        if (frequency === 0) {
            // Jednorazowa loteria - jeśli wykonujemy, to NULL (brak następnego losowania)
            if (isExecuting) {
                return null;
            }
            // Jeśli nie wykonujemy, zwróć aktualną datę
            return currentDrawDate;
        }
        
        // Dla cyklicznych loterii - dodaj frequency dni do aktualnej daty
        const currentDate = new Date(currentDrawDate);
        const nextDate = new Date(currentDate);
        nextDate.setDate(currentDate.getDate() + frequency);
        
        // Ustaw czas w polskiej strefie czasowej
        const year = nextDate.getFullYear();
        const month = String(nextDate.getMonth() + 1).padStart(2, '0');
        const day = String(nextDate.getDate()).padStart(2, '0');
        const hourStr = String(hour).padStart(2, '0');
        const minuteStr = String(minute).padStart(2, '0');
        
        const dateTimeString = `${year}-${month}-${day}T${hourStr}:${minuteStr}:00`;
        const polishTime = new Date(dateTimeString);
        
        // Sprawdź czy to czas letni czy zimowy i skoryguj
        const isWinter = this.isWinterTime(polishTime);
        const offsetHours = isWinter ? -1 : -2;
        polishTime.setHours(polishTime.getHours() + offsetHours);
        
        return polishTime.toISOString();
    }

    /**
     * Planuje następne losowanie
     */
    scheduleNextLottery(lotteryId, lottery) {
        try {
            // Usuń istniejące cron jobs jeśli istnieją
            if (this.cronJobs.has(lotteryId)) {
                const oldJob = this.cronJobs.get(lotteryId);
                if (oldJob && typeof oldJob.destroy === 'function') {
                    oldJob.destroy();
                }
                this.cronJobs.delete(lotteryId);
            }
            
            if (this.cronJobs.has(lotteryId + '_warning')) {
                const oldWarningJob = this.cronJobs.get(lotteryId + '_warning');
                if (oldWarningJob && typeof oldWarningJob.destroy === 'function') {
                    oldWarningJob.destroy();
                }
                this.cronJobs.delete(lotteryId + '_warning');
            }
            
            if (this.cronJobs.has(lotteryId + '_final')) {
                const oldFinalJob = this.cronJobs.get(lotteryId + '_final');
                if (oldFinalJob && typeof oldFinalJob.destroy === 'function') {
                    oldFinalJob.destroy();
                }
                this.cronJobs.delete(lotteryId + '_final');
            }

            // Wyczyść długoterminowy timer jeśli istnieje
            if (this.cronJobs.has(lotteryId + '_longterm')) {
                const oldLongtermJob = this.cronJobs.get(lotteryId + '_longterm');
                if (oldLongtermJob && typeof oldLongtermJob.destroy === 'function') {
                    oldLongtermJob.destroy();
                }
                this.cronJobs.delete(lotteryId + '_longterm');
            }

            // Dla jednorazowych loterii (frequency = 0) użyj prostego timeoutu zamiast cron
            if (lottery.frequency === 0) {
                const nextDrawTime = new Date(lottery.nextDraw);
                const now = new Date();
                const timeToWait = nextDrawTime.getTime() - now.getTime();
                
                // Maksymalny bezpieczny timeout w JavaScript (~24 dni)
                const MAX_TIMEOUT = 2147483647;

                if (timeToWait <= 0) {
                    logger.warn(`⚠️ Jednorazowa loteria ${lotteryId} ma datę w przeszłości - wykonuję natychmiast`);
                    setTimeout(() => this.executeLottery(lotteryId), 1000);
                } else if (timeToWait > MAX_TIMEOUT) {
                    // Dla długoterminowych loterii (>24 dni) ustaw sprawdzenie co 24h
                    logger.info(`📅 Jednorazowa loteria ${lotteryId} jest zaplanowana za ${Math.round(timeToWait / (24*60*60*1000))} dni - ustawiam sprawdzanie co 24h`);
                    this.scheduleLongTermCheck(lotteryId, lottery);
                    return;
                } else {
                    const polishTime = this.convertUTCToPolishTime(nextDrawTime);
                logger.info(`📅 Zaplanowano jednorazową loterię ${lottery.name} za ${Math.round(timeToWait / 60000)} minut (${polishTime})`);
                    
                    // Ustaw timeout dla głównego losowania
                    const mainTimeout = setTimeout(() => {
                        this.executeLottery(lotteryId);
                    }, timeToWait);
                    
                    this.cronJobs.set(lotteryId, { destroy: () => clearTimeout(mainTimeout) });
                    
                    // Ustaw ostrzeżenie 30 minut wcześniej (jeśli jest wystarczająco czasu)
                    const warningTime = timeToWait - (30 * 60 * 1000); // 30 minut wcześniej
                    if (warningTime > 0 && warningTime <= MAX_TIMEOUT) {
                        const warningTimeout = setTimeout(() => {
                            this.sendClosingWarning(lotteryId);
                        }, warningTime);
                        
                        this.cronJobs.set(lotteryId + '_warning', { destroy: () => clearTimeout(warningTimeout) });
                    }
                    
                    // Ustaw finalne ostrzeżenie 90 minut wcześniej (jeśli jest wystarczająco czasu)
                    const finalTime = timeToWait - (90 * 60 * 1000); // 90 minut wcześniej
                    if (finalTime > 0 && finalTime <= MAX_TIMEOUT) {
                        const finalTimeout = setTimeout(() => {
                            this.sendFinalWarning(lotteryId);
                        }, finalTime);
                        
                        this.cronJobs.set(lotteryId + '_final', { destroy: () => clearTimeout(finalTimeout) });
                    }
                }
                return;
            }

            // Dla cyklicznych loterii używamy timeoutów na konkretne daty
            const nextDrawTime = new Date(lottery.nextDraw);
            const now = new Date();
            const timeToWait = nextDrawTime.getTime() - now.getTime();
            
            // Maksymalny bezpieczny timeout w JavaScript (~24 dni)
            const MAX_TIMEOUT = 2147483647;

            if (timeToWait <= 0) {
                logger.warn(`⚠️ Cykliczna loteria ${lotteryId} ma datę w przeszłości - wykonuję natychmiast`);
                setTimeout(() => this.executeLottery(lotteryId), 1000);
            } else if (timeToWait > MAX_TIMEOUT) {
                // Dla długoterminowych loterii (>24 dni) ustaw sprawdzenie co 24h
                logger.info(`📅 Cykliczna loteria ${lotteryId} jest zaplanowana za ${Math.round(timeToWait / (24*60*60*1000))} dni - ustawiam sprawdzanie co 24h`);
                this.scheduleLongTermCheck(lotteryId, lottery);
                return;
            } else {
                const polishTime = this.convertUTCToPolishTime(nextDrawTime);
                logger.info(`📅 Zaplanowano cykliczną loterię ${lottery.name} za ${Math.round(timeToWait / 60000)} minut (${polishTime})`);
                
                // Ustaw timeout dla głównego losowania
                const mainTimeout = setTimeout(() => {
                    this.executeLottery(lotteryId);
                }, timeToWait);
                
                this.cronJobs.set(lotteryId, { destroy: () => clearTimeout(mainTimeout) });
                
                // Ustaw ostrzeżenie 30 minut wcześniej (jeśli jest wystarczająco czasu)
                const warningTime = timeToWait - (30 * 60 * 1000); // 30 minut wcześniej
                if (warningTime > 0 && warningTime <= MAX_TIMEOUT) {
                    const warningTimeout = setTimeout(() => {
                        this.sendClosingWarning(lotteryId);
                    }, warningTime);
                    
                    this.cronJobs.set(lotteryId + '_warning', { destroy: () => clearTimeout(warningTimeout) });
                }
                
                // Ustaw finalne ostrzeżenie 90 minut wcześniej (jeśli jest wystarczająco czasu)
                const finalTime = timeToWait - (90 * 60 * 1000); // 90 minut wcześniej
                if (finalTime > 0 && finalTime <= MAX_TIMEOUT) {
                    const finalTimeout = setTimeout(() => {
                        this.sendFinalWarning(lotteryId);
                    }, finalTime);
                    
                    this.cronJobs.set(lotteryId + '_final', { destroy: () => clearTimeout(finalTimeout) });
                }
            }
        } catch (error) {
            logger.error(`❌ Błąd planowania loterii ${lotteryId}:`, error);
            throw error;
        }
    }

    /**
     * Wysyła ostrzeżenie o zamknięciu zgłoszeń 30 minut przed loterią
     */
    async sendClosingWarning(lotteryId) {
        try {
            const lottery = this.activeLotteries.get(lotteryId);
            if (!lottery) {
                logger.error(`❌ Nie znaleziono loterii dla ostrzeżenia: ${lotteryId}`);
                return;
            }

            const guild = this.client.guilds.cache.get(this.config.guildId);
            if (!guild) {
                logger.error('❌ Nie znaleziono serwera');
                return;
            }

            // POPRAWIONA LOGIKA: Ostrzeżenia na kanały OCR gdy loteria dotyczy roli Daily/CX
            let channelType = '';
            let targetWarningChannelId = '';
            
            // Sprawdź czy to loteria dla roli Daily
            if (lottery.targetRoleId === this.config.channels.daily.requiredRoleId) {
                channelType = 'Daily';
                targetWarningChannelId = this.config.channels.daily.targetChannelId; // Wyślij na kanał Daily OCR
            } 
            // Sprawdź czy to loteria dla roli CX
            else if (lottery.targetRoleId === this.config.channels.cx.requiredRoleId) {
                channelType = 'CX';
                targetWarningChannelId = this.config.channels.cx.targetChannelId; // Wyślij na kanał CX OCR
            } 
            // Inne role = brak ostrzeżeń
            else {
                logger.info(`📋 Pomijam ostrzeżenie zamknięcia - loteria ${lotteryId} nie dotyczy roli Daily ani CX`);
                return;
            }

            // Sprawdź czy ostrzeżenie już zostało wysłane dla tego typu kanału w tej godzinie
            const now = new Date();
            const warningKey = `closing_${channelType}_${now.getDate()}_${now.getMonth()}_${now.getHours()}_${now.getMinutes()}`;
            
            if (this.sentWarnings.has(warningKey)) {
                logger.info(`📋 Ostrzeżenie zamknięcia już wysłane dla ${channelType} w tym czasie - pomijanie`);
                return;
            }

            const channel = guild.channels.cache.get(targetWarningChannelId);
            if (!channel) {
                logger.error(`❌ Nie znaleziono kanału ostrzeżeń: ${targetWarningChannelId}`);
                return;
            }

            // Określ rolę na podstawie roli docelowej loterii
            let roleId = lottery.targetRoleId;
            let warningMessage = `# Zamykam zbieranie zgloszeń! <a:PepeHmm:1278016984772247645>\n<@&${roleId}> Zgłaszanie do kolejnej loterii zostanie odblokowane w stosownym czasie! Za 30 min losowanie.`;

            await channel.send({
                content: warningMessage,
                allowedMentions: { roles: [roleId] }
            });

            // Zaznacz że ostrzeżenie zostało wysłane
            this.sentWarnings.set(warningKey, now.getTime());
            logger.info(`✅ Wysłano ostrzeżenie o zamknięciu zgłoszeń dla ${channelType} na kanał ${channel.name}`);

        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania ostrzeżenia o zamknięciu zgłoszeń ${lotteryId}:`, error);
        }
    }

    /**
     * Wysyła finalne ostrzeżenie o ostatniej godzinie na wrzucenie zdjęcia 90 minut przed loterią
     */
    async sendFinalWarning(lotteryId) {
        try {
            const lottery = this.activeLotteries.get(lotteryId);
            if (!lottery) {
                logger.error(`❌ Nie znaleziono loterii dla finalnego ostrzeżenia: ${lotteryId}`);
                return;
            }

            const guild = this.client.guilds.cache.get(this.config.guildId);
            if (!guild) {
                logger.error('❌ Nie znaleziono serwera');
                return;
            }

            // POPRAWIONA LOGIKA: Ostrzeżenia na kanały OCR gdy loteria dotyczy roli Daily/CX
            let channelType = '';
            let targetWarningChannelId = '';
            
            // Sprawdź czy to loteria dla roli Daily
            if (lottery.targetRoleId === this.config.channels.daily.requiredRoleId) {
                channelType = 'Daily';
                targetWarningChannelId = this.config.channels.daily.targetChannelId; // Wyślij na kanał Daily OCR
            } 
            // Sprawdź czy to loteria dla roli CX
            else if (lottery.targetRoleId === this.config.channels.cx.requiredRoleId) {
                channelType = 'CX';
                targetWarningChannelId = this.config.channels.cx.targetChannelId; // Wyślij na kanał CX OCR
            } 
            // Inne role = brak ostrzeżeń
            else {
                logger.info(`📋 Pomijam finalne ostrzeżenie - loteria ${lotteryId} nie dotyczy roli Daily ani CX`);
                return;
            }

            // Sprawdź czy finalne ostrzeżenie już zostało wysłane dla tego typu kanału w tej godzinie
            const now = new Date();
            const warningKey = `final_${channelType}_${now.getDate()}_${now.getMonth()}_${now.getHours()}_${now.getMinutes()}`;
            
            if (this.sentWarnings.has(warningKey)) {
                logger.info(`📋 Finalne ostrzeżenie już wysłane dla ${channelType} w tym czasie - pomijanie`);
                return;
            }

            const channel = guild.channels.cache.get(targetWarningChannelId);
            if (!channel) {
                logger.error(`❌ Nie znaleziono kanału ostrzeżeń: ${targetWarningChannelId}`);
                return;
            }

            // Zbierz role klanów tylko z tej konkretnej loterii (nie wszystkich aktywnych)
            const clanRoles = [];
            
            if (lottery.clanRoleId) {
                // Jeśli loteria ma określony klan, pinguj tylko ten klan
                clanRoles.push(lottery.clanRoleId);
            } else {
                // Jeśli loteria jest dla "całego serwera", pinguj wszystkie klany
                for (const [clanKey, clanConfig] of Object.entries(this.config.lottery.clans)) {
                    if (clanConfig.roleId) {
                        clanRoles.push(clanConfig.roleId);
                    }
                }
            }

            // Utwórz pingowanie ról
            const rolePings = clanRoles.map(roleId => `<@&${roleId}>`).join(' ');
            
            let finalWarningMessage = `${rolePings}\n# Ostatnia godzina na wrzucenie zdjęcia z ${channelType} <a:X_Uwaga2:1297532628395622440>`;

            await channel.send({
                content: finalWarningMessage,
                allowedMentions: { roles: clanRoles }
            });

            // Zaznacz że finalne ostrzeżenie zostało wysłane
            this.sentWarnings.set(warningKey, now.getTime());
            logger.info(`✅ Wysłano finalne ostrzeżenie dla ${channelType} na kanał ${channel.name} (${clanRoles.length} ról pingowanych)`);

        } catch (error) {
            logger.error(`❌ Błąd podczas wysyłania finalnego ostrzeżenia ${lotteryId}:`, error);
        }
    }

    /**
     * Wykonuje losowanie
     */
    async executeLottery(lotteryId) {
        try {
            const lottery = this.activeLotteries.get(lotteryId);
            if (!lottery) {
                logger.error(`❌ Nie znaleziono loterii: ${lotteryId}`);
                return;
            }

            logger.info(`🎰 Rozpoczynam losowanie: ${lottery.name}`);

            const guild = this.client.guilds.cache.get(this.config.guildId);
            if (!guild) {
                logger.error('❌ Nie znaleziono serwera');
                return;
            }

            const channel = guild.channels.cache.get(lottery.channelId);
            if (!channel) {
                logger.error(`❌ Nie znaleziono kanału: ${lottery.channelId}`);
                return;
            }

            logger.info(`✅ Znaleziono serwer: ${guild.name} i kanał: ${channel.name}`);

            // Pobierz członków z wymaganymi rolami (z odświeżaniem cache)
            logger.info('🔄 Odświeżanie cache ról i członków...');
            
            // Odśwież cache ról
            await guild.roles.fetch();
            
            // Odśwież cache członków przed pokazaniem debug listy
            try {
                await guild.members.fetch({ limit: 1000 });
                logger.info(`📊 Po odświeżeniu: ${guild.members.cache.size} członków w cache`);
            } catch (error) {
                logger.warn(`⚠️ Nie udało się odświeżyć członków przed debug: ${error.message}`);
            }
            
            // Debug - pokaż wszystkie role na serwerze dla weryfikacji ID
            logger.info('🔍 DEBUG - Lista wszystkich ról na serwerze:');
            const sortedRoles = guild.roles.cache
                .filter(role => role.name !== '@everyone')
                .sort((a, b) => b.position - a.position)
                .map(role => `   ${role.name} (ID: ${role.id}) - ${role.members.size} członków`)
                .slice(0, 20); // Pokaż tylko pierwsze 20 ról
            
            sortedRoles.forEach(roleInfo => logger.info(roleInfo));
            if (guild.roles.cache.size > 21) {
                logger.info(`   ... i ${guild.roles.cache.size - 21} innych ról`);
            }
            
            const targetRole = guild.roles.cache.get(lottery.targetRoleId);
            const clanRole = lottery.clanRoleId ? guild.roles.cache.get(lottery.clanRoleId) : null;
            const blockedRole = guild.roles.cache.get(this.config.blockedRole);
            
            if (!targetRole) {
                logger.error(`❌ Nie znaleziono roli docelowej: ${lottery.targetRoleId}`);
                return;
            }
            
            if (lottery.clanRoleId && !clanRole) {
                logger.error(`❌ Nie znaleziono roli klanu: ${lottery.clanRoleId}`);
                return;
            }
            
            logger.info(`🎯 Rola docelowa: ${targetRole.name}`);
            if (clanRole) {
                logger.info(`🏰 Rola klanu: ${clanRole.name}`);
            } else {
                logger.info(`🌍 Zakres: Cały serwer (bez ograniczenia do klanu)`);
            }
            
            if (blockedRole) {
                logger.info(`🚫 Rola blokująca: ${blockedRole.name} (${blockedRole.members.size} członków z blokadą)`);
                // Pokaż kto ma rolę blokującą
                if (blockedRole.members.size > 0 && blockedRole.members.size <= 10) {
                    logger.info(`🚫 Członkowie z rolą blokującą:`);
                    for (const [memberId, member] of blockedRole.members) {
                        logger.info(`   - ${member.user.tag} (${member.id})`);
                    }
                }
            } else {
                logger.warn(`⚠️ Nie znaleziono roli blokującej o ID: ${this.config.blockedRole}`);
            }
            
            // Pobieranie członków w zależności od zakresu (klan vs cały serwer)
            if (clanRole) {
                // Tradycyjne podejście - skupiamy się na członkach klanu
                logger.info('🔄 Sprawdzanie członków klanu...');
                logger.info(`🏰 Rola klanu: ${clanRole.name} (${clanRole.members.size} członków w cache)`);
                
                // Jeśli rola klanu nadal nie ma członków po wcześniejszym odświeżeniu, spróbuj większego limitu
                if (clanRole.members.size === 0) {
                    logger.info('🔄 Rola klanu nadal nie ma członków - próbuję większy limit...');
                    
                    try {
                        await Promise.race([
                            guild.members.fetch({ limit: 2000 }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout podczas pobierania członków')), 30000)
                            )
                        ]);
                        
                        logger.info(`📊 Po pobraniu większej próbki: ${guild.members.cache.size} członków w cache`);
                        logger.info(`🏰 Rola klanu teraz ma: ${clanRole.members.size} członków`);
                        
                        // Debug - sprawdź czy rola klanu w ogóle istnieje
                        if (clanRole.members.size === 0) {
                            logger.warn(`🔍 DEBUG - Sprawdzam czy rola klanu istnieje:`);
                            logger.warn(`   - ID roli klanu: ${lottery.clanRoleId}`);
                            logger.warn(`   - Nazwa roli: ${clanRole.name}`);
                            logger.warn(`   - Pozycja roli: ${clanRole.position}`);
                            logger.warn(`   - Czy rola jest zarządzana przez bota: ${clanRole.managed}`);
                            
                            // Sprawdź ręcznie czy ktoś ma tę rolę
                            let foundManually = 0;
                            for (const [memberId, member] of guild.members.cache) {
                                if (member.roles.cache.has(lottery.clanRoleId)) {
                                    foundManually++;
                                    logger.info(`🔍 Znaleziono ręcznie: ${member.user.tag} ma rolę klanu`);
                                    if (foundManually >= 3) {
                                        logger.info(`🔍 ... i więcej (pokazano tylko pierwsze 3)`);
                                        break;
                                    }
                                }
                            }
                            logger.warn(`📊 Ręczne sprawdzenie znalazło ${foundManually} członków z rolą klanu`);
                        }
                        
                    } catch (error) {
                        logger.warn(`⚠️ Nie udało się pobrać większej próbki członków: ${error.message}`);
                        logger.info(`ℹ️ Kontynuuję z aktualnym cache (${clanRole.members.size} członków klanu)`);
                    }
                } else {
                    logger.info(`✅ Rola klanu ma ${clanRole.members.size} członków w cache`);
                }
            } else {
                // Tryb "cały serwer" - pobieranie członków z rolą docelową
                logger.info('🌍 Sprawdzanie członków dla całego serwera...');
                logger.info(`🎯 Rola docelowa: ${targetRole.name} (${targetRole.members.size} członków w cache)`);
                
                // Jeśli rola docelowa nadal nie ma członków, spróbuj pobrać wszystkich
                if (targetRole.members.size === 0) {
                    logger.info('🔄 Rola docelowa nadal nie ma członków - pobieranie wszystkich...');
                    
                    try {
                        await guild.members.fetch();
                        logger.info(`📊 Po pobraniu wszystkich: ${guild.members.cache.size} członków w cache`);
                        logger.info(`🎯 Rola docelowa teraz ma: ${targetRole.members.size} członków`);
                        
                        // Debug - sprawdź czy rola docelowa w ogóle istnieje
                        if (targetRole.members.size === 0) {
                            logger.warn(`🔍 DEBUG - Sprawdzam czy rola docelowa istnieje:`);
                            logger.warn(`   - ID roli docelowej: ${lottery.targetRoleId}`);
                            logger.warn(`   - Nazwa roli: ${targetRole.name}`);
                            logger.warn(`   - Pozycja roli: ${targetRole.position}`);
                            logger.warn(`   - Czy rola jest zarządzana przez bota: ${targetRole.managed}`);
                            
                            // Sprawdź ręcznie czy ktoś ma tę rolę
                            let foundManually = 0;
                            for (const [memberId, member] of guild.members.cache) {
                                if (member.roles.cache.has(lottery.targetRoleId)) {
                                    foundManually++;
                                    logger.info(`🔍 Znaleziono ręcznie: ${member.user.tag} ma rolę docelową`);
                                    if (foundManually >= 3) {
                                        logger.info(`🔍 ... i więcej (pokazano tylko pierwsze 3)`);
                                        break;
                                    }
                                }
                            }
                            logger.warn(`📊 Ręczne sprawdzenie znalazło ${foundManually} członków z rolą docelową`);
                        }
                        
                    } catch (error) {
                        logger.warn(`⚠️ Nie udało się pobrać wszystkich członków: ${error.message}`);
                        logger.info(`ℹ️ Kontynuuję z aktualnym cache (${targetRole.members.size} członków z rolą docelową)`);
                    }
                } else {
                    logger.info(`✅ Rola docelowa ma ${targetRole.members.size} członków w cache`);
                }
            }
            
            logger.info(`🎯 Rola docelowa: ${targetRole.name} (${targetRole.members.size} członków po odświeżeniu)`);
            if (clanRole) {
                logger.info(`🏰 Rola klanu: ${clanRole.name} (${clanRole.members.size} członków po odświeżeniu)`);
            } else {
                logger.info(`🌍 Zakres: Cały serwer (bez ograniczenia do klanu)`);
            }
            if (blockedRole) {
                logger.info(`🚫 Rola blokująca: ${blockedRole.name} (${blockedRole.members.size} członków z blokadą po odświeżeniu)`);
            }
            
            
            // Debug roli blokującej
            if (blockedRole && blockedRole.members.size > 0) {
                logger.info(`🚫 Członkowie z rolą blokującą "${blockedRole.name}" (${blockedRole.members.size}):`);
                for (const [memberId, member] of blockedRole.members) {
                }
            } else if (blockedRole) {
                logger.info(`✅ Brak członków z rolą blokującą "${blockedRole.name}"`);
            }
            
            const eligibleMembers = new Map();
            
            if (clanRole) {
                // TRYB KLANU: Iteruj przez członków KLANU i sprawdź czy mają rolę docelową
                logger.info('🔍 Rozpoczynam wyszukiwanie kwalifikowanych członków klanu...');
                logger.info(`📊 Sprawdzam ${clanRole.members.size} członków klanu ${clanRole.name}`);
                
                let checkedClanMembers = 0;
                
                for (const [memberId, member] of clanRole.members) {
                    checkedClanMembers++;
                    
                    const hasTargetRole = member.roles.cache.has(lottery.targetRoleId);
                    const hasBlockedRole = member.roles.cache.has(this.config.blockedRole);
                    const isBot = member.user.bot;
                    
                    const isEligible = hasTargetRole && !hasBlockedRole && !isBot;
                    
                    if (isEligible) {
                        logger.info(`✅ Kwalifikuje się: ${member.user.tag} (${member.id}) - członek klanu z rolą docelową`);
                        eligibleMembers.set(memberId, member);
                    } else {
                        const reasons = [];
                        if (!hasTargetRole) reasons.push(`brak roli docelowej (${lottery.targetRoleId})`);
                        if (hasBlockedRole) reasons.push(`ma rolę blokującą (${this.config.blockedRole})`);
                        if (isBot) reasons.push('to bot');
                        
                        // Log tylko jeśli ma przynajmniej jedną istotną przyczynę dyskwalifikacji
                        if (!hasTargetRole || hasBlockedRole) {
                            logger.info(`❌ Nie kwalifikuje się: ${member.user.tag} - ${reasons.join(', ')}`);
                        }
                    }
                }
                
                logger.info(`📊 Sprawdzono ${checkedClanMembers} członków klanu, znaleziono ${eligibleMembers.size} kwalifikowanych`);
                
                
            } else {
                // TRYB CAŁY SERWER: Iteruj przez członków z ROLĄ DOCELOWĄ (bez ograniczenia do klanu)
                logger.info('🌍 Rozpoczynam wyszukiwanie kwalifikowanych członków na całym serwerze...');
                logger.info(`📊 Sprawdzam ${targetRole.members.size} członków z rolą docelową`);
                
                
                let checkedTargetMembers = 0;
                
                for (const [memberId, member] of targetRole.members) {
                    checkedTargetMembers++;
                    
                    const hasBlockedRole = member.roles.cache.has(this.config.blockedRole);
                    const isBot = member.user.bot;
                    
                    const isEligible = !hasBlockedRole && !isBot;
                    
                    if (isEligible) {
                        logger.info(`✅ Kwalifikuje się: ${member.user.tag} (${member.id}) - członek serwera z rolą docelową`);
                        eligibleMembers.set(memberId, member);
                    } else {
                        const reasons = [];
                        if (hasBlockedRole) reasons.push(`ma rolę blokującą (${this.config.blockedRole})`);
                        if (isBot) reasons.push('to bot');
                        
                        if (hasBlockedRole || isBot) {
                            logger.info(`❌ Nie kwalifikuje się: ${member.user.tag} - ${reasons.join(', ')}`);
                        }
                    }
                }
                
                logger.info(`📊 Sprawdzono ${checkedTargetMembers} członków serwera, znaleziono ${eligibleMembers.size} kwalifikowanych`);
            }
            

            logger.info(`🎯 Znaleziono ${eligibleMembers.size} kwalifikujących się uczestników`);

            if (eligibleMembers.size === 0) {
                const { EmbedBuilder } = require('discord.js');
                logger.warn('⚠️ Brak uczestników - wysyłam powiadomienie');
                
                let requirements = `**Wymagania:**\n• Rola docelowa: <@&${lottery.targetRoleId}>\n`;
                if (clanRole) {
                    requirements += `• Rola klanu: <@&${lottery.clanRoleId}>\n`;
                } else {
                    requirements += `• Zakres: Cały serwer (bez ograniczenia do klanu)\n`;
                }
                requirements += `• Brak roli blokującej: <@&${this.config.blockedRole}>`;

                await channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🎰 Loteria - Brak uczestników')
                        .setDescription(`Nie znaleziono żadnych kwalifikujących się uczestników dla loterii **${lottery.name}**\n\n${requirements}`)
                        .setColor('#ff6b6b')
                        .setTimestamp()]
                });
                return;
            }

            logger.info(`🎲 Losowanie dla ${eligibleMembers.size} uczestników (${lottery.winnersCount} zwycięzców)`);

            // Przeprowadź losowanie
            const winners = this.drawWinners(eligibleMembers, lottery.winnersCount, guild, lottery);
            
            logger.info(`🏆 Wylosowano ${winners.length} zwycięzców:`);
            winners.forEach((winner, index) => {
                logger.info(`   ${index + 1}. ${winner.user.tag} (${winner.id})`);
            });

            // Zapisz wyniki
            await this.saveLotteryResult(lottery, eligibleMembers, winners);

            // Oblicz następną datę losowania PRZED publikacją wyników
            let nextDrawDate = null;
            if (lottery.frequency !== 0) {
                nextDrawDate = this.calculateNextDraw(lottery.nextDraw, lottery.hour, lottery.minute, true, lottery.frequency);
                lottery.nextDraw = nextDrawDate;
            }

            // Opublikuj wyniki (z już obliczoną datą następnej loterii)
            await this.publishResults(channel, lottery, eligibleMembers, winners);

            // Zaplanuj następne losowanie lub usuń jeśli jednorazowe
            if (lottery.frequency === 0) {
                logger.info('🔚 Jednorazowa loteria - usuwanie z aktywnych...');
                
                // Usuń cron job
                if (this.cronJobs.has(lotteryId)) {
                    const job = this.cronJobs.get(lotteryId);
                    if (job && typeof job.destroy === 'function') {
                        job.destroy();
                    } else if (job && typeof job.stop === 'function') {
                        job.stop();
                    }
                    this.cronJobs.delete(lotteryId);
                }
                
                // Usuń z aktywnych loterii
                this.activeLotteries.delete(lotteryId);
                
                await this.saveLotteryData();
            } else {
                lottery.lastDraw = new Date().toISOString();
                // nextDraw już obliczone wcześniej przed publikacją wyników
                
                await this.saveLotteryData();
                
                // Zaplanuj ponownie cron jobs dla następnego losowania
                try {
                    this.scheduleNextLottery(lotteryId, lottery);
                } catch (error) {
                    logger.error(`❌ Nie można zaplanować następnego losowania dla ${lotteryId}: ${error.message}`);
                    logger.warn(`⚠️ Loteria ${lottery.name} zostanie ponownie zaplanowana przy następnym restarcie bota`);
                }
                
            }

            logger.info(`✅ Zakończono losowanie: ${lottery.name} - wygrało ${winners.length} osób`);

        } catch (error) {
            logger.error(`❌ Błąd wykonywania loterii ${lotteryId}:`, error);
            logger.error('Stack trace:', error.stack);
        }
    }

    /**
     * Losuje zwycięzców
     */
    drawWinners(eligibleMembers, winnersCount, guild = null, lottery = null) {
        const membersArray = Array.from(eligibleMembers.values());
        const winners = [];

        const actualWinnersCount = Math.min(winnersCount, membersArray.length);

        // Sprawdź czy to loteria CX i czy mamy dostęp do guild
        let specialRoleId = null;
        if (guild && lottery && lottery.targetRoleId) {
            // Sprawdź czy to może być CX na podstawie roli docelowej
            const cxConfig = this.config.channels.cx;
            if (cxConfig && lottery.targetRoleId === cxConfig.requiredRoleId && cxConfig.specialRole) {
                specialRoleId = cxConfig.specialRole.roleId;
                logger.info(`🎲 Loteria CX wykryta - uwzględniam rolę specjalną ${specialRoleId}`);
            }
        }

        // Utwórz pulę z podwójnymi wpisami dla użytkowników z rolą specjalną
        let lotteryPool = [];
        let specialRoleCount = 0;

        for (const member of membersArray) {
            lotteryPool.push(member);

            // Sprawdź czy użytkownik ma rolę specjalną CX
            if (specialRoleId && member.roles.cache.has(specialRoleId)) {
                lotteryPool.push(member); // Dodaj drugi wpis (podwójna szansa)
                specialRoleCount++;
                logger.info(`🎲 Użytkownik ${member.displayName} ma dodatkową szansę (specjalna rola CX)`);
            }
        }

        if (specialRoleCount > 0) {
            logger.info(`👑 ${specialRoleCount} użytkowników ma podwójną szansę w loterii CX`);
            logger.info(`🎲 Pula losowania: ${membersArray.length} członków → ${lotteryPool.length} wpisów`);
        }

        // Losowanie bez powtórzeń (ale jeden użytkownik może mieć więcej wpisów)
        const shuffled = lotteryPool.sort(() => 0.5 - Math.random());
        const selectedMembers = new Set();

        for (let i = 0; i < shuffled.length && winners.length < actualWinnersCount; i++) {
            const member = shuffled[i];
            if (!selectedMembers.has(member.id)) {
                winners.push(member);
                selectedMembers.add(member.id);
            }
        }

        return winners;
    }

    /**
     * Zapisuje wynik loterii
     */
    async saveLotteryResult(lottery, participants, winners) {
        try {
            const result = {
                lotteryId: lottery.id,
                lotteryName: lottery.name,
                date: new Date().toISOString(),
                participantCount: participants.size,
                participants: Array.from(participants.values()).map(member => ({
                    id: member.user.id,
                    username: member.user.username,
                    displayName: member.displayName
                })),
                winners: winners.map(winner => ({
                    id: winner.user.id,
                    username: winner.user.username,
                    displayName: winner.displayName
                })),
                targetRole: lottery.targetRoleId,
                clanRole: lottery.clanRoleId,
                clanName: lottery.clanName
            };

            // Wczytaj istniejące dane
            let data = {};
            try {
                const fileContent = await fs.readFile(this.config.lottery.dataFile, 'utf8');
                data = JSON.parse(fileContent);
            } catch (error) {
                // Plik nie istnieje lub jest uszkodzony
            }

            // Dodaj nowy wynik
            if (!data.results) data.results = [];
            data.results.push(result);
            
            // Zachowaj tylko ostatnie 50 wyników
            if (data.results.length > 50) {
                data.results = data.results.slice(-50);
            }

            // Zapisz aktualny stan aktywnych loterii
            data.activeLotteries = Object.fromEntries(this.activeLotteries);
            data.lastUpdated = new Date().toISOString();

            await fs.writeFile(this.config.lottery.dataFile, JSON.stringify(data, null, 2));
            
            
        } catch (error) {
            logger.error('❌ Błąd zapisu wyniku loterii:', error);
        }
    }

    /**
     * Publikuje wyniki loterii
     */
    async publishResults(channel, lottery, participants, winners) {
        try {
            logger.info('📝 Tworzenie embed z wynikami...');
            
            const { EmbedBuilder } = require('discord.js');
            const embed = new EmbedBuilder()
                .setTitle('🎰 WYNIKI LOTERII')
                .setDescription(`**${lottery.name}**`)
                .setColor('#00ff00')
                .addFields(
                    {
                        name: '👥 Liczba uczestników',
                        value: participants.size.toString(),
                        inline: true
                    },
                    {
                        name: '🏆 Zwycięzcy',
                        value: winners.length > 0 
                            ? winners.map((winner, index) => `${index + 1}. ${winner.displayName} (<@${winner.user.id}>)`).join('\n')
                            : 'Brak zwycięzców',
                        inline: false
                    }
                )
                .setFooter({ 
                    text: lottery.frequency === 0 
                        ? `Loteria ID: ${this.formatLotteryIdForDisplay(lottery.id)} | Loteria jednorazowa`
                        : `Loteria ID: ${this.formatLotteryIdForDisplay(lottery.id)} | Następna: ${this.convertUTCToPolishTime(new Date(lottery.nextDraw))}`
                })
                .setTimestamp();

            logger.info(`📤 Wysyłanie wyników na kanał: ${channel.name} (${channel.id})`);
            
            const message = await channel.send({ embeds: [embed] });
            
            logger.info(`✅ Wyniki zostały opublikowane - ID wiadomości: ${message.id}`);
            
        } catch (error) {
            logger.error('❌ Błąd publikowania wyników:', error);
            logger.error('Stack trace:', error.stack);
            throw error;
        }
    }

    /**
     * Pobiera historię loterii
     */
    async getLotteryHistory() {
        try {
            const data = await fs.readFile(this.config.lottery.dataFile, 'utf8');
            const parsed = JSON.parse(data);
            
            // Połącz oryginalne wyniki z rerolls i posortuj po dacie
            const results = parsed.results || [];
            const rerolls = parsed.rerolls || [];
            
            const allHistory = [...results, ...rerolls].sort((a, b) => {
                try {
                    const dateA = new Date(a.originalDate || a.date);
                    const dateB = new Date(b.originalDate || b.date);
                    
                    // Sprawdź czy daty są prawidłowe
                    if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
                        // Jeśli jedna z dat jest nieprawidłowa, użyj fallback
                        return 0;
                    }
                    
                    return dateA - dateB;
                } catch (sortError) {
                    // Jeśli sortowanie się wysupi, użyj fallback
                    return 0;
                }
            });
            
            return allHistory;
        } catch (error) {
            logger.error('❌ Błąd w getLotteryHistory():', error);
            logger.error('❌ Szczegóły błędu:', error.message);
            return [];
        }
    }

    /**
     * Wykonuje ponowne losowanie dla wybranej loterii
     */
    async rerollLottery(interaction, resultIndex, additionalWinners = 1) {
        try {
            const history = await this.getLotteryHistory();
            
            if (resultIndex >= history.length || resultIndex < 0) {
                throw new Error('Nieprawidłowy indeks wyniku loterii');
            }

            const originalResult = history[resultIndex];
            
            // Pobierz oryginalnych uczestników i zwycięzców (dla rerolls może być zagnieżdżone)
            let originalParticipants = originalResult.participants;
            let allOriginalWinners = [];
            
            // Jeśli to reroll, pobierz dane z oryginalnej loterii i wszystkie poprzednie zwycięzców
            if (originalResult.originalWinners) {
                // To jest reroll - zachowaj oryginalnych uczestników
                originalParticipants = originalResult.participants;
                allOriginalWinners = [...originalResult.originalWinners, ...originalResult.newWinners];
            } else {
                // To jest oryginalna loteria
                allOriginalWinners = originalResult.winners;
            }
            
            // Usuń wszystkich dotychczasowych zwycięzców z puli
            const originalWinnerIds = allOriginalWinners.map(w => w.id);
            const eligibleForReroll = originalParticipants.filter(p => !originalWinnerIds.includes(p.id));

            if (eligibleForReroll.length === 0) {
                throw new Error('Brak osób kwalifikujących się do ponownego losowania');
            }

            // Użyj oryginalnych uczestników bez sprawdzania aktualnych ról
            // Konwertuj do formatu wymaganego przez drawWinners
            const participantsMap = new Map();
            eligibleForReroll.forEach(participant => {
                participantsMap.set(participant.id, participant);
            });

            // Przeprowadź ponowne losowanie
            const additionalWinnersCount = Math.min(additionalWinners, eligibleForReroll.length);
            const newWinners = this.drawWinners(participantsMap, additionalWinnersCount);

            // Wygeneruj unikalne ID dla rerollu
            let rerollNumber = 1;
            let baseId = originalResult.lotteryId;
            
            // Jeśli to już reroll, pobierz bazowe ID
            if (baseId.includes('_reroll')) {
                const parts = baseId.split('_reroll');
                baseId = parts[0];
            }
            
            // Znajdź najwyższy numer rerollu dla tego bazowego ID
            const lotteryData = await this.loadLotteryData();
            const existingRerolls = lotteryData.rerolls || [];
            
            existingRerolls.forEach(reroll => {
                if (reroll.lotteryId.startsWith(baseId + '_reroll')) {
                    const match = reroll.lotteryId.match(/_reroll(\d+)$/);
                    if (match) {
                        const num = parseInt(match[1]);
                        if (num >= rerollNumber) {
                            rerollNumber = num + 1;
                        }
                    } else if (reroll.lotteryId === baseId + '_reroll') {
                        // Pierwszy reroll bez numeru
                        if (rerollNumber === 1) {
                            rerollNumber = 2;
                        }
                    }
                }
            });

            // Zapisz wynik ponownego losowania
            const rerollResult = {
                lotteryId: rerollNumber === 1 ? baseId + '_reroll' : baseId + '_reroll' + rerollNumber,
                lotteryName: (originalResult.lotteryName.replace(/ \(Reroll \d+\)$/, '').replace(/ \(Ponowne losowanie\)$/, '')) + ` (Reroll ${rerollNumber})`,
                originalDate: originalResult.originalDate || originalResult.date,
                rerollDate: new Date().toISOString(),
                originalParticipantCount: originalResult.originalParticipantCount || originalResult.participantCount,
                rerollParticipantCount: eligibleForReroll.length,
                participants: originalParticipants,
                originalWinners: originalResult.originalWinners || originalResult.winners,
                newWinners: newWinners.map(winner => ({
                    id: winner.id,
                    username: winner.username,
                    displayName: winner.displayName
                })),
                targetRole: originalResult.targetRole,
                clanRole: originalResult.clanRole,
                clanName: originalResult.clanName,
                rerolledBy: interaction.user.id
            };

            // Zapisz do historii
            const data = await this.loadLotteryData();
            if (!data.rerolls) data.rerolls = [];
            data.rerolls.push(rerollResult);
            await fs.writeFile(this.config.lottery.dataFile, JSON.stringify(data, null, 2));

            return {
                success: true,
                originalResult,
                newWinners,
                rerollResult
            };

        } catch (error) {
            logger.error('❌ Błąd ponownego losowania:', error);
            throw error;
        }
    }

    /**
     * Wczytuje dane loterii z pliku
     */
    async loadLotteryData() {
        try {
            const data = await fs.readFile(this.config.lottery.dataFile, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    /**
     * Usuwa loterię
     */
    async removeLottery(lotteryId) {
        try {
            // Zatrzymaj cron job loterii
            if (this.cronJobs.has(lotteryId)) {
                const job = this.cronJobs.get(lotteryId);
                if (job && typeof job.destroy === 'function') {
                    job.destroy();
                } else if (job && typeof job.stop === 'function') {
                    job.stop();
                }
                this.cronJobs.delete(lotteryId);
            }

            // Zatrzymaj cron job ostrzeżenia
            if (this.cronJobs.has(lotteryId + '_warning')) {
                const warningJob = this.cronJobs.get(lotteryId + '_warning');
                if (warningJob && typeof warningJob.destroy === 'function') {
                    warningJob.destroy();
                } else if (warningJob && typeof warningJob.stop === 'function') {
                    warningJob.stop();
                }
                this.cronJobs.delete(lotteryId + '_warning');
            }

            // Zatrzymaj cron job finalnego ostrzeżenia
            if (this.cronJobs.has(lotteryId + '_final')) {
                const finalJob = this.cronJobs.get(lotteryId + '_final');
                logger.info(`🛑 Zatrzymywanie cron job finalnego ostrzeżenia dla loterii: ${lotteryId}`);
                
                if (finalJob && typeof finalJob.destroy === 'function') {
                    finalJob.destroy();
                } else if (finalJob && typeof finalJob.stop === 'function') {
                    finalJob.stop();
                } else {
                    logger.warn(`⚠️ Cron job finalnego ostrzeżenia dla ${lotteryId} nie ma metody destroy() ani stop()`);
                }
                
                this.cronJobs.delete(lotteryId + '_final');
                logger.info(`✅ Usunięto cron job finalnego ostrzeżenia dla: ${lotteryId}`);
            } else {
                logger.warn(`⚠️ Nie znaleziono cron job finalnego ostrzeżenia dla loterii: ${lotteryId}`);
            }

            // Usuń z aktywnych loterii
            if (this.activeLotteries.has(lotteryId)) {
                this.activeLotteries.delete(lotteryId);
                logger.info(`✅ Usunięto loterię z aktywnych: ${lotteryId}`);
            } else {
                logger.warn(`⚠️ Nie znaleziono aktywnej loterii: ${lotteryId}`);
            }

            // Zapisz zmiany
            await this.saveLotteryData();

            logger.info(`🗑️ Pomyślnie usunięto loterię: ${lotteryId}`);
        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania loterii ${lotteryId}:`, error);
            throw error;
        }
    }

    /**
     * Pobiera listę aktywnych loterii
     */
    getActiveLotteries() {
        return Array.from(this.activeLotteries.values());
    }

    /**
     * Pobiera aktywne loterie dla określonej roli docelowej
     * @param {string} targetRoleId - ID roli docelowej (Daily/CX)
     * @returns {Array} Lista aktywnych loterii dla tej roli
     */
    getActiveLotteriesForRole(targetRoleId) {
        const lotteriesForRole = [];
        
        for (const [lotteryId, lottery] of this.activeLotteries.entries()) {
            if (lottery.targetRoleId === targetRoleId) {
                const clanType = lottery.clanType || lottery.clanKey; // Kompatybilność ze starymi loteriami
                logger.info(`🔍 Znaleziono loterię dla roli ${targetRoleId}: ID=${lotteryId}, nazwa=${lottery.name}, winners=${lottery.winnersCount || lottery.winners}, clanType=${clanType}`);
                
                // Sprawdź czy to stara loteria bez wymaganych pól
                if (!lottery.name || (lottery.winners === undefined && lottery.winnersCount === undefined) || (!lottery.clanType && !lottery.clanKey)) {
                    logger.warn(`⚠️ Pomijam starą loterię ${lotteryId} z niepełnymi danymi`);
                    continue;
                }
                
                lotteriesForRole.push({
                    id: lotteryId,
                    name: lottery.name,
                    frequency: lottery.frequency,
                    nextDraw: lottery.nextDraw,
                    winners: lottery.winnersCount || lottery.winners,
                    clanType: clanType
                });
            }
        }
        
        return lotteriesForRole;
    }

    /**
     * Pobiera pełną nazwę klanu na podstawie clanType
     * @param {string} clanType - Typ klanu (server, main, 0, 1, 2)
     * @returns {string} Pełna nazwa klanu
     */
    getClanDisplayName(clanType) {
        const clanConfig = this.config.lottery.clans[clanType];
        if (clanConfig) {
            return clanConfig.name; // Używaj `name` zamiast `displayName` bo displayName ma emoji
        }
        
        // Fallback dla nieznanych typów
        switch (clanType) {
            case 'server': return 'Cały serwer';
            case 'main': return 'Polski Squad';
            case '0': return 'PolskiSquad⁰';
            case '1': return 'PolskiSquad¹';
            case '2': return 'PolskiSquad²';
            default: return `Squad ${clanType || 'nieznany'}`;
        }
    }

    /**
     * Formatuje informację o aktywnych loteriach dla określonej roli
     * @param {string} targetRoleId - ID roli docelowej (Daily/CX)
     * @returns {string} Sformatowana informacja o loteriach
     */
    formatActiveLotteriesInfo(targetRoleId) {
        const lotteries = this.getActiveLotteriesForRole(targetRoleId);
        
        if (lotteries.length === 0) {
            return '';
        }

        const lotteryInfos = [];
        
        for (const lottery of lotteries) {
            try {
                const nextDrawText = lottery.frequency === 0 
                    ? 'Jednorazowa' 
                    : this.convertUTCToPolishTime(new Date(lottery.nextDraw));
                
                const clanText = this.getClanDisplayName(lottery.clanType);
                
                const winnersCount = lottery.winners || 1;
                const winnersText = winnersCount === 1 ? '1 zwycięzca' : `${winnersCount} zwycięzców`;
                
                lotteryInfos.push(`${clanText} - ${winnersText} - ${nextDrawText}`);
            } catch (error) {
                logger.error(`❌ Błąd formatowania loterii ${lottery.id}:`, error);
                logger.error(`Dane loterii:`, lottery);
            }
        }
        
        return lotteryInfos.join('\n');
    }

    /**
     * Sprawdza czy dla danego klanu i roli jest aktywna loteria
     * @param {string} clanRoleId - ID roli klanu użytkownika
     * @param {string} targetRoleId - ID roli docelowej (Daily/CX)
     * @returns {boolean} Czy istnieje aktywna loteria
     */
    isLotteryActive(clanRoleId, targetRoleId) {
        logger.info(`🔍 Sprawdzam aktywne loterie dla klanu ${clanRoleId || 'Cały serwer'} i roli ${targetRoleId}`);
        logger.info(`📊 Mam ${this.activeLotteries.size} aktywnych loterii w pamięci`);
        
        if (this.activeLotteries.size === 0) {
            logger.warn(`⚠️ Brak aktywnych loterii w pamięci - sprawdź czy dane zostały poprawnie wczytane`);
        }
        
        for (const [lotteryId, lottery] of this.activeLotteries.entries()) {
            logger.info(`🎲 Loteria ${lotteryId}: name=${lottery.name}, clanRoleId=${lottery.clanRoleId}, targetRoleId=${lottery.targetRoleId}`);
            
            // Sprawdź czy jest to loteria dla tej roli docelowej
            if (lottery.targetRoleId === targetRoleId) {
                // Sprawdź czy klan pasuje (null oznacza "cały serwer")
                if (lottery.clanRoleId === null || lottery.clanRoleId === clanRoleId) {
                    logger.info(`✅ Znaleziono aktywną loterię: ${lottery.name} dla klanu ${clanRoleId || 'Cały serwer'} i roli ${targetRoleId}`);
                    return true;
                }
            }
        }
        
        logger.info(`❌ Brak aktywnej loterii dla klanu ${clanRoleId || 'Cały serwer'} i roli ${targetRoleId}`);
        return false;
    }

    /**
     * Sprawdza czy użytkownik ma jakąkolwiek rolę klanu i czy istnieje loteria dla tej kombinacji
     * @param {GuildMember} member - Członek serwera
     * @param {string} targetRoleId - ID roli docelowej (Daily/CX)
     * @returns {Object} Wynik sprawdzenia z informacją o klanie i aktywności loterii
     */
    checkUserLotteryEligibility(member, targetRoleId) {
        // Sprawdź wszystkie role klanów zdefiniowane w konfiguracji
        const clans = this.config.lottery.clans;
        
        for (const [clanKey, clanConfig] of Object.entries(clans)) {
            if (clanConfig.roleId && member.roles.cache.has(clanConfig.roleId)) {
                // Użytkownik ma rolę tego klanu
                const isActive = this.isLotteryActive(clanConfig.roleId, targetRoleId);
                return {
                    hasValidClan: true,
                    clanKey: clanKey,
                    clanName: clanConfig.displayName,
                    clanRoleId: clanConfig.roleId,
                    isLotteryActive: isActive
                };
            }
        }
        
        // Sprawdź czy jest loteria dla "całego serwera" (clanRoleId = null)
        const isServerWideLotteryActive = this.isLotteryActive(null, targetRoleId);
        
        return {
            hasValidClan: false,
            clanKey: null,
            clanName: 'Cały serwer',
            clanRoleId: null,
            isLotteryActive: isServerWideLotteryActive
        };
    }

    /**
     * Sprawdza czy aktualnie jest dozwolone okno czasowe dla przesyłania screenów
     * @param {string} targetRoleId - ID roli docelowej (Daily/CX)
     * @param {string} clanRoleId - ID roli klanu (może być null)
     * @returns {Object} Informacja o dozwolonym oknie czasowym
     */
    checkSubmissionTimeWindow(targetRoleId, clanRoleId) {
        // Znajdź aktywną loterię dla tego klanu i roli
        let activeLottery = null;
        
        for (const lottery of this.activeLotteries.values()) {
            if (lottery.targetRoleId === targetRoleId) {
                if (lottery.clanRoleId === null || lottery.clanRoleId === clanRoleId) {
                    activeLottery = lottery;
                    break;
                }
            }
        }
        
        if (!activeLottery) {
            return {
                isAllowed: false,
                reason: 'NO_LOTTERY',
                message: 'Brak aktywnej loterii'
            };
        }
        
        const now = new Date();
        const nextDrawDate = new Date(activeLottery.nextDraw);
        
        // Oblicz różnicę w godzinach do następnego losowania
        const hoursUntilDraw = (nextDrawDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        
        // Określ typ kanału na podstawie targetRoleId
        let channelType;
        let maxHoursBeforeDraw;
        
        if (targetRoleId === this.config.channels.daily.requiredRoleId) {
            channelType = 'Daily';
            maxHoursBeforeDraw = 25; // 25 godzin przed losowaniem
        } else if (targetRoleId === this.config.channels.cx.requiredRoleId) {
            channelType = 'CX';
            maxHoursBeforeDraw = 313; // 313 godzin (13 dni) przed losowaniem
        } else {
            return {
                isAllowed: false,
                reason: 'UNKNOWN_ROLE',
                message: 'Nieznana rola docelowa'
            };
        }
        
        // Sprawdź czy jesteśmy w dozwolonym oknie czasowym
        if (hoursUntilDraw <= maxHoursBeforeDraw) {
            return {
                isAllowed: true,
                channelType: channelType,
                hoursUntilDraw: Math.floor(hoursUntilDraw),
                nextDrawDate: nextDrawDate
            };
        } else {
            const hoursToWait = Math.ceil(hoursUntilDraw - maxHoursBeforeDraw);
            return {
                isAllowed: false,
                reason: 'TOO_EARLY',
                channelType: channelType,
                hoursUntilDraw: Math.floor(hoursUntilDraw),
                hoursToWait: hoursToWait,
                nextDrawDate: nextDrawDate,
                message: `Aktualnie nie jest możliwe zgromadzenie odpowiedniej ilości punktów by zakwalifikować się do losowania.\nWróć, gdy będziesz miał odpowiednią ilość punktów!`
            };
        }
    }

    /**
     * Formatuje ID loterii dla wyświetlania
     */
    formatLotteryIdForDisplay(lotteryId) {
        const parts = lotteryId.split('_');
        if (parts.length >= 3) {
            const datePart = parts[0];
            const rolePart = parts[1];
            const clanPart = parts[2];
            const formattedDate = `${datePart.slice(0,4)}-${datePart.slice(4,6)}-${datePart.slice(6,8)}`;
            return `${formattedDate}|${rolePart}|${clanPart}`;
        }
        return lotteryId;
    }

    /**
     * Zatrzymuje serwis
     */
    stop() {
        // Zatrzymaj wszystkie cron jobs (włącznie z ostrzeżeniami)
        for (const [jobId, job] of this.cronJobs.entries()) {
            try {
                if (job && typeof job.destroy === 'function') {
                    job.destroy();
                } else if (job && typeof job.stop === 'function') {
                    job.stop();
                } else {
                    logger.warn(`⚠️ Nie można zatrzymać cron job ${jobId}: brak metody destroy() lub stop()`);
                }
            } catch (error) {
                logger.error(`❌ Błąd zatrzymywania cron job ${jobId}:`, error);
            }
        }
        this.cronJobs.clear();
        
        logger.info('🛑 Serwis loterii został zatrzymany');
        
        // Wyczyść mapę wysłanych ostrzeżeń
        this.sentWarnings.clear();
    }
    
    /**
     * Czyści stare ostrzeżenia z mapy (starsze niż 24 godziny)
     */
    cleanupOldWarnings() {
        const now = Date.now();
        const oneDayMs = 24 * 60 * 60 * 1000;
        
        for (const [key, timestamp] of this.sentWarnings.entries()) {
            if (now - timestamp > oneDayMs) {
                this.sentWarnings.delete(key);
            }
        }
    }

    /**
     * Usuwa loterię z historii
     */
    async removeHistoricalLottery(historyIndex) {
        try {
            const data = await this.loadLotteryData();
            const history = [...(data.results || []), ...(data.rerolls || [])].sort((a, b) => {
                const dateA = new Date(a.originalDate || a.date);
                const dateB = new Date(b.originalDate || b.date);
                return dateA - dateB;
            });

            if (historyIndex >= history.length || historyIndex < 0) {
                throw new Error('Nieprawidłowy indeks loterii historycznej');
            }

            const lotteryToRemove = history[historyIndex];
            logger.info(`🗑️ Usuwanie loterii historycznej: ${lotteryToRemove.lotteryName} (${lotteryToRemove.lotteryId})`);

            // Usuń z odpowiedniej tablicy
            if (lotteryToRemove.lotteryId && lotteryToRemove.lotteryId.includes('_reroll')) {
                // To jest reroll - usuń z tablicy rerolls
                if (data.rerolls) {
                    data.rerolls = data.rerolls.filter(reroll => reroll.lotteryId !== lotteryToRemove.lotteryId);
                }
            } else {
                // To jest oryginalna loteria - usuń z tablicy results
                if (data.results) {
                    data.results = data.results.filter(result => result.lotteryId !== lotteryToRemove.lotteryId);
                }
                
                // Usuń także wszystkie związane rerolls
                if (data.rerolls) {
                    const baseId = lotteryToRemove.lotteryId;
                    data.rerolls = data.rerolls.filter(reroll => !reroll.lotteryId.startsWith(baseId + '_reroll'));
                    logger.info(`🗑️ Usunięto także wszystkie rerolls dla loterii: ${baseId}`);
                }
            }

            // Zapisz zmiany
            data.lastUpdated = new Date().toISOString();
            await fs.writeFile(this.config.lottery.dataFile, JSON.stringify(data, null, 2));
            
            logger.info(`✅ Pomyślnie usunięto loterię historyczną: ${lotteryToRemove.lotteryName}`);
            return {
                success: true,
                removedLottery: lotteryToRemove
            };

        } catch (error) {
            logger.error(`❌ Błąd podczas usuwania loterii historycznej:`, error);
            throw error;
        }
    }

    /**
     * Planuje sprawdzanie długoterminowych loterii co 24h
     * @param {string} lotteryId - ID loterii
     * @param {Object} lottery - Obiekt loterii
     */
    scheduleLongTermCheck(lotteryId, lottery) {
        // Ustaw sprawdzenie co 24h (lub krócej jeśli bliżej niż 24h do losowania)
        const nextDrawTime = new Date(lottery.nextDraw);
        const now = new Date();
        const timeToWait = nextDrawTime.getTime() - now.getTime();

        // Jeśli zostało mniej niż 24h, ustaw dokładny timer
        const checkInterval = Math.min(timeToWait, 24 * 60 * 60 * 1000); // 24h maksymalnie

        const polishTime = this.convertUTCToPolishTime(nextDrawTime);
        logger.info(`⏰ Ustawiono sprawdzenie długoterminowej loterii ${lottery.name} za ${Math.round(checkInterval / (60*60*1000))} godzin (docelowa data: ${polishTime})`);

        const checkTimeout = setTimeout(() => {
            // Sprawdź czy loteria nadal istnieje
            if (!this.activeLotteries.has(lotteryId)) {
                logger.info(`ℹ️ Loteria ${lotteryId} została usunięta - anulowanie sprawdzania długoterminowego`);
                return;
            }

            // Sprawdź czy już czas na losowanie
            const currentTime = new Date();
            const currentTimeToWait = nextDrawTime.getTime() - currentTime.getTime();

            if (currentTimeToWait <= 0) {
                // Czas minął - wykonaj lotę
                logger.info(`🎰 Czas na długoterminową loterię ${lottery.name} - wykonuję natychmiast`);
                setTimeout(() => this.executeLottery(lotteryId), 1000);
            } else if (currentTimeToWait <= 2147483647) {
                // Mniej niż 24 dni - można użyć normalnego planowania
                logger.info(`📅 Długoterminowa loteria ${lottery.name} jest już w zasięgu normalnego planowania`);
                this.scheduleNextLottery(lotteryId, lottery);
            } else {
                // Nadal za daleko - zaplanuj kolejne sprawdzenie
                logger.info(`⏰ Długoterminowa loteria ${lottery.name} nadal za daleko - planowanie kolejnego sprawdzenia`);
                this.scheduleLongTermCheck(lotteryId, lottery);
            }
        }, checkInterval);

        // Zapisz timeout do czyszczenia
        this.cronJobs.set(lotteryId + '_longterm', { destroy: () => clearTimeout(checkTimeout) });
    }
}

module.exports = LotteryService;