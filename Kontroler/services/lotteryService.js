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
        
        logger.info('✅ Serwis loterii został zainicjalizowany');
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
            const lotteryData = JSON.parse(data);
            
            if (lotteryData.activeLotteries) {
                // Przywróć aktywne loterie
                for (const [id, lottery] of Object.entries(lotteryData.activeLotteries)) {
                    this.activeLotteries.set(id, lottery);
                    this.scheduleNextLottery(id, lottery);
                }
                logger.info(`🔄 Przywrócono ${this.activeLotteries.size} aktywnych loterii`);
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
            
            logger.info(`💾 Zapisywanie ${this.activeLotteries.size} aktywnych loterii do pliku`);
            await fs.writeFile(this.config.lottery.dataFile, JSON.stringify(dataToSave, null, 2));
            logger.info('✅ Dane loterii zostały zapisane pomyślnie');
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
            dayOfWeek,
            hour,
            minute,
            winnersCount,
            channelId
        } = lotteryData;

        const clan = this.config.lottery.clans[clanKey];
        if (!clan) {
            throw new Error(`Nieprawidłowy klucz klanu: ${clanKey}`);
        }

        // Generuj czytelny ID z datą, rolą i klanem
        const nextDrawDate = this.calculateNextDraw(dayOfWeek, hour, minute);
        const nextDrawTimestamp = new Date(nextDrawDate).getTime();
        const formattedDate = new Date(nextDrawTimestamp).toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
        const roleShort = targetRole.name.toLowerCase().replace(/[^a-z0-9]/g, '').substring(0, 6);
        const clanShort = clanKey.toLowerCase();
        const randomSuffix = Math.random().toString(36).substr(2, 4);
        
        const lotteryId = `${formattedDate}_${roleShort}_${clanShort}_${randomSuffix}`;
        
        logger.info(`🆔 Generowanie ID loterii: ${lotteryId} (data: ${formattedDate}, rola: ${roleShort}, klan: ${clanShort})`);

        const lottery = {
            id: lotteryId,
            name: `Loteria ${targetRole.name} - ${clan.displayName}`,
            targetRoleId: targetRole.id,
            clanRoleId: clan.roleId,
            clanKey: clanKey,
            clanName: clan.name,
            clanDisplayName: clan.displayName,
            frequency: frequency,
            dayOfWeek: dayOfWeek,
            hour: hour,
            minute: minute,
            winnersCount: winnersCount,
            channelId: channelId,
            createdBy: interaction.user.id,
            createdAt: new Date().toISOString(),
            lastDraw: null,
            nextDraw: nextDrawDate
        };

        // Zapisz loterię
        this.activeLotteries.set(lotteryId, lottery);
        await this.saveLotteryData();

        // Zaplanuj pierwsze losowanie
        this.scheduleNextLottery(lotteryId, lottery);

        logger.info(`🎰 Utworzono nową loterię: ${lottery.name} (ID: ${lotteryId})`);
        
        return {
            success: true,
            lottery: lottery
        };
    }

    /**
     * Oblicza następny termin losowania
     */
    calculateNextDraw(dayOfWeek, hour, minute) {
        const now = new Date();
        const dayNum = this.config.lottery.dayMap[dayOfWeek];
        
        let nextDraw = new Date();
        nextDraw.setHours(hour, minute, 0, 0);
        
        // Znajdź następny termin dla tego dnia tygodnia
        let daysToAdd = (dayNum - now.getDay() + 7) % 7;
        
        // Jeśli to dziś, ale godzina już minęła, to następny taki dzień
        if (daysToAdd === 0 && now >= nextDraw) {
            daysToAdd = 7;
        }
        
        nextDraw.setDate(now.getDate() + daysToAdd);
        
        return nextDraw.toISOString();
    }

    /**
     * Planuje następne losowanie
     */
    scheduleNextLottery(lotteryId, lottery) {
        try {
            // Usuń istniejący cron job jeśli istnieje
            if (this.cronJobs.has(lotteryId)) {
                const oldJob = this.cronJobs.get(lotteryId);
                if (oldJob && typeof oldJob.destroy === 'function') {
                    oldJob.destroy();
                }
                this.cronJobs.delete(lotteryId);
            }

            const dayNum = this.config.lottery.dayMap[lottery.dayOfWeek];
            
            if (dayNum === undefined) {
                throw new Error(`Nieprawidłowy dzień tygodnia: ${lottery.dayOfWeek}`);
            }
            
            // Utwórz cron pattern: minute hour * * dayOfWeek
            const cronPattern = `${lottery.minute} ${lottery.hour} * * ${dayNum}`;
            logger.info(`🕐 Tworzę cron pattern: ${cronPattern} dla loterii ${lotteryId}`);
            
            const job = cron.schedule(cronPattern, async () => {
                logger.info(`🎰 Wykonywanie zaplanowanej loterii: ${lotteryId}`);
                await this.executeLottery(lotteryId);
            }, {
                timezone: "Europe/Warsaw"
            });

            this.cronJobs.set(lotteryId, job);
            
            logger.info(`📅 Zaplanowano loterię ${lotteryId} na ${lottery.dayOfWeek} o ${lottery.hour}:${lottery.minute.toString().padStart(2, '0')} (pattern: ${cronPattern})`);
        } catch (error) {
            logger.error(`❌ Błąd planowania loterii ${lotteryId}:`, error);
            throw error;
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

            // Pobierz członków z odpowiednimi rolami
            await guild.members.fetch();
            
            const eligibleMembers = guild.members.cache.filter(member => {
                // Musi mieć rolę docelową
                if (!member.roles.cache.has(lottery.targetRoleId)) return false;
                
                // Musi mieć rolę klanu
                if (!member.roles.cache.has(lottery.clanRoleId)) return false;
                
                // Nie może mieć roli blokującej
                if (member.roles.cache.has(this.config.blockedRole)) return false;
                
                // Nie może być botem
                if (member.user.bot) return false;
                
                return true;
            });

            if (eligibleMembers.size === 0) {
                await channel.send({
                    embeds: [new EmbedBuilder()
                        .setTitle('🎰 Loteria - Brak uczestników')
                        .setDescription(`Nie znaleziono żadnych kwalifikujących się uczestników dla loterii **${lottery.name}**`)
                        .setColor('#ff6b6b')
                        .setTimestamp()]
                });
                return;
            }

            // Przeprowadź losowanie
            const winners = this.drawWinners(eligibleMembers, lottery.winnersCount);
            
            // Zapisz wyniki
            await this.saveLotteryResult(lottery, eligibleMembers, winners);

            // Opublikuj wyniki
            await this.publishResults(channel, lottery, eligibleMembers, winners);

            // Zaplanuj następne losowanie
            lottery.lastDraw = new Date().toISOString();
            lottery.nextDraw = this.calculateNextDraw(lottery.dayOfWeek, lottery.hour, lottery.minute);
            
            await this.saveLotteryData();

            logger.info(`✅ Zakończono losowanie: ${lottery.name} - wygrało ${winners.length} osób`);

        } catch (error) {
            logger.error(`❌ Błąd wykonywania loterii ${lotteryId}:`, error);
        }
    }

    /**
     * Losuje zwycięzców
     */
    drawWinners(eligibleMembers, winnersCount) {
        const membersArray = Array.from(eligibleMembers.values());
        const winners = [];
        
        const actualWinnersCount = Math.min(winnersCount, membersArray.length);
        
        // Losowanie bez powtórzeń
        const shuffled = membersArray.sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < actualWinnersCount; i++) {
            winners.push(shuffled[i]);
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
                participants: participants.map(member => ({
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
            
            logger.info(`💾 Zapisano wynik loterii: ${lottery.name}`);
            
        } catch (error) {
            logger.error('❌ Błąd zapisu wyniku loterii:', error);
        }
    }

    /**
     * Publikuje wyniki loterii
     */
    async publishResults(channel, lottery, participants, winners) {
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
                    name: '🎯 Liczba zwycięzców',
                    value: winners.length.toString(),
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
                text: `Loteria ID: ${this.formatLotteryIdForDisplay(lottery.id)} | Następna: ${new Date(lottery.nextDraw).toLocaleString('pl-PL')}` 
            })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    }

    /**
     * Pobiera historię loterii
     */
    async getLotteryHistory() {
        try {
            const data = await fs.readFile(this.config.lottery.dataFile, 'utf8');
            const parsed = JSON.parse(data);
            return parsed.results || [];
        } catch (error) {
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
            
            // Pobierz członków którzy nie wygrali w oryginalnej loterii
            const guild = this.client.guilds.cache.get(this.config.guildId);
            await guild.members.fetch();

            const originalWinnerIds = originalResult.winners.map(w => w.id);
            const eligibleForReroll = originalResult.participants.filter(p => !originalWinnerIds.includes(p.id));

            if (eligibleForReroll.length === 0) {
                throw new Error('Brak osób kwalifikujących się do ponownego losowania');
            }

            // Sprawdź czy uczestnicy nadal są na serwerze i mają odpowiednie role
            const validParticipants = [];
            for (const participant of eligibleForReroll) {
                const member = guild.members.cache.get(participant.id);
                if (member && 
                    member.roles.cache.has(originalResult.targetRole) &&
                    member.roles.cache.has(originalResult.clanRole) &&
                    !member.roles.cache.has(this.config.blockedRole)) {
                    validParticipants.push(member);
                }
            }

            if (validParticipants.length === 0) {
                throw new Error('Brak aktualnie kwalifikujących się osób do ponownego losowania');
            }

            // Przeprowadź ponowne losowanie
            const additionalWinnersCount = Math.min(additionalWinners, validParticipants.length);
            const newWinners = this.drawWinners(new Map(validParticipants.map(m => [m.id, m])), additionalWinnersCount);

            // Zapisz wynik ponownego losowania
            const rerollResult = {
                lotteryId: originalResult.lotteryId + '_reroll',
                lotteryName: originalResult.lotteryName + ' (Ponowne losowanie)',
                originalDate: originalResult.date,
                rerollDate: new Date().toISOString(),
                originalParticipantCount: originalResult.participantCount,
                rerollParticipantCount: validParticipants.length,
                originalWinners: originalResult.winners,
                newWinners: newWinners.map(winner => ({
                    id: winner.user.id,
                    username: winner.user.username,
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
            // Zatrzymaj cron job
            if (this.cronJobs.has(lotteryId)) {
                const job = this.cronJobs.get(lotteryId);
                logger.info(`🛑 Zatrzymywanie cron job dla loterii: ${lotteryId}`);
                
                if (job && typeof job.destroy === 'function') {
                    job.destroy();
                } else if (job && typeof job.stop === 'function') {
                    job.stop();
                } else {
                    logger.warn(`⚠️ Cron job dla ${lotteryId} nie ma metody destroy() ani stop()`);
                }
                
                this.cronJobs.delete(lotteryId);
                logger.info(`✅ Usunięto cron job dla: ${lotteryId}`);
            } else {
                logger.warn(`⚠️ Nie znaleziono cron job dla loterii: ${lotteryId}`);
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
        // Zatrzymaj wszystkie cron jobs
        for (const [lotteryId, job] of this.cronJobs.entries()) {
            try {
                if (job && typeof job.destroy === 'function') {
                    job.destroy();
                } else if (job && typeof job.stop === 'function') {
                    job.stop();
                } else {
                    logger.warn(`⚠️ Nie można zatrzymać cron job dla loterii ${lotteryId}: brak metody destroy() lub stop()`);
                }
            } catch (error) {
                logger.error(`❌ Błąd zatrzymywania cron job ${lotteryId}:`, error);
            }
        }
        this.cronJobs.clear();
        
        logger.info('🛑 Serwis loterii został zatrzymany');
    }
}

module.exports = LotteryService;