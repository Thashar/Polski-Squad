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
            clanRoleId: clan.roleId, // może być null dla opcji "cały serwer"
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
            logger.info(`📋 Szczegóły loterii:`);
            logger.info(`   - Rola docelowa: ${lottery.targetRoleId}`);
            logger.info(`   - Rola klanu: ${lottery.clanRoleId}`);
            logger.info(`   - Kanał: ${lottery.channelId}`);
            logger.info(`   - Zwycięzców: ${lottery.winnersCount}`);

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
            } else {
                logger.warn(`⚠️ Nie znaleziono roli blokującej o ID: ${this.config.blockedRole}`);
            }
            
            // Pobieranie członków w zależności od zakresu (klan vs cały serwer)
            if (clanRole) {
                // Tradycyjne podejście - skupiamy się na członkach klanu
                logger.info('🔄 Pobieranie członków klanu...');
                logger.info(`🏰 Rola klanu: ${clanRole.name} (${clanRole.members.size} członków w cache)`);
                
                // Jeśli rola klanu nie ma członków w cache, spróbuj odświeżyć
                if (clanRole.members.size === 0) {
                    logger.info('🔄 Rola klanu nie ma członków - odświeżanie...');
                    
                    try {
                        // Pobierz więcej członków serwera (role są już w cache po guild.roles.fetch())
                        logger.info('🔄 Pobieranie większej próbki członków serwera...');
                        
                        await Promise.race([
                            guild.members.fetch({ limit: 1000 }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout podczas pobierania członków')), 30000)
                            )
                        ]);
                        
                        logger.info(`📊 Po pobraniu próbki: ${guild.members.cache.size} członków w cache`);
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
                        logger.warn(`⚠️ Nie udało się odświeżyć członków klanu: ${error.message}`);
                        logger.info(`ℹ️ Kontynuuję z aktualnym cache (${clanRole.members.size} członków klanu)`);
                    }
                } else {
                    logger.info(`✅ Rola klanu ma ${clanRole.members.size} członków w cache`);
                }
            } else {
                // Tryb "cały serwer" - pobieranie członków z rolą docelową
                logger.info('🌍 Pobieranie członków dla całego serwera...');
                logger.info(`🎯 Rola docelowa: ${targetRole.name} (${targetRole.members.size} członków w cache)`);
                
                // Jeśli rola docelowa nie ma członków w cache, spróbuj odświeżyć
                if (targetRole.members.size === 0) {
                    logger.info('🔄 Rola docelowa nie ma członków - odświeżanie...');
                    
                    try {
                        // Pobierz więcej członków serwera (role są już w cache po guild.roles.fetch())
                        logger.info('🔄 Pobieranie próbki członków serwera...');
                        
                        await Promise.race([
                            guild.members.fetch({ limit: 2000 }),
                            new Promise((_, reject) => 
                                setTimeout(() => reject(new Error('Timeout podczas pobierania członków')), 45000)
                            )
                        ]);
                        
                        logger.info(`📊 Po pobraniu próbki: ${guild.members.cache.size} członków w cache`);
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
                        logger.warn(`⚠️ Nie udało się odświeżyć członków z rolą docelową: ${error.message}`);
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
            
            // Dodatkowe sprawdzenie - jeśli role nadal mają 0 członków, spróbuj alternatywnego podejścia
            if (targetRole.members.size === 0 || (clanRole && clanRole.members.size === 0)) {
                logger.warn('⚠️ Role nadal nie mają członków w cache - próbuję alternatywne podejście...');
                
                try {
                    // Pobierz więcej członków serwera (role są już odświeżone)
                    logger.info('🔄 Ostatnia próba - pobieranie dodatkowych członków...');
                    
                    await Promise.race([
                        guild.members.fetch({ limit: 3000 }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout podczas finalnego pobierania członków')), 60000)
                        )
                    ]);
                    
                    logger.info(`🔄 Po finalnym pobieraniu:`);
                    logger.info(`📊 Członkowie w cache: ${guild.members.cache.size}`);
                    logger.info(`🎯 Rola docelowa: ${targetRole.name} (${targetRole.members.size} członków)`);
                    if (clanRole) {
                        logger.info(`🏰 Rola klanu: ${clanRole.name} (${clanRole.members.size} członków)`);
                    }
                } catch (roleError) {
                    logger.warn(`⚠️ Nie udało się pobrać dodatkowych członków: ${roleError.message}`);
                }
            }
            
            // Debug roli blokującej
            if (blockedRole && blockedRole.members.size > 0) {
                logger.info(`🚫 Członkowie z rolą blokującą "${blockedRole.name}" (${blockedRole.members.size}):`);
                for (const [memberId, member] of blockedRole.members) {
                    logger.info(`   🚫 ${member.user.tag} (${member.id}) - zablokowany w loterii`);
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
                
                // Jeśli rola klanu była pusta, spróbuj alternatywnego podejścia
                if (eligibleMembers.size === 0 && clanRole.members.size === 0) {
                    logger.warn('⚠️ Rola klanu nie ma członków - próbuję alternatywnego wyszukiwania...');
                    
                    // Sprawdź ręcznie członków z rolą docelową pod kątem przynależności do klanu
                    logger.info(`🔍 Sprawdzam ${targetRole.members.size} członków z rolą docelową pod kątem klanu...`);
                    
                    for (const [memberId, member] of targetRole.members) {
                        const hasClanRole = member.roles.cache.has(lottery.clanRoleId);
                        const hasBlockedRole = member.roles.cache.has(this.config.blockedRole);
                        const isBot = member.user.bot;
                        
                        const isEligible = hasClanRole && !hasBlockedRole && !isBot;
                        
                        if (isEligible) {
                            logger.info(`✅ Alternatywnie znaleziony: ${member.user.tag} (${member.id})`);
                            eligibleMembers.set(memberId, member);
                        }
                    }
                    
                    logger.info(`📊 Alternatywne wyszukiwanie znalazło ${eligibleMembers.size} kwalifikowanych członków`);
                }
                
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

            logger.info(`🎲 Przeprowadzam losowanie spośród ${eligibleMembers.size} uczestników na ${lottery.winnersCount} zwycięzców`);

            // Przeprowadź losowanie
            const winners = this.drawWinners(eligibleMembers, lottery.winnersCount);
            
            logger.info(`🏆 Wylosowano ${winners.length} zwycięzców:`);
            winners.forEach((winner, index) => {
                logger.info(`   ${index + 1}. ${winner.user.tag} (${winner.id})`);
            });

            // Zapisz wyniki
            logger.info('💾 Zapisywanie wyników loterii...');
            await this.saveLotteryResult(lottery, eligibleMembers, winners);

            // Opublikuj wyniki
            logger.info('📢 Publikowanie wyników...');
            await this.publishResults(channel, lottery, eligibleMembers, winners);

            // Zaplanuj następne losowanie
            logger.info('📅 Planowanie następnego losowania...');
            lottery.lastDraw = new Date().toISOString();
            lottery.nextDraw = this.calculateNextDraw(lottery.dayOfWeek, lottery.hour, lottery.minute);
            
            await this.saveLotteryData();

            logger.info(`✅ Zakończono losowanie: ${lottery.name} - wygrało ${winners.length} osób`);

        } catch (error) {
            logger.error(`❌ Błąd wykonywania loterii ${lotteryId}:`, error);
            logger.error('Stack trace:', error.stack);
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
            
            logger.info(`💾 Zapisano wynik loterii: ${lottery.name}`);
            
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
            
            // Pobierz uczestników którzy nie wygrali w oryginalnej loterii
            const originalWinnerIds = originalResult.winners.map(w => w.id);
            const eligibleForReroll = originalResult.participants.filter(p => !originalWinnerIds.includes(p.id));

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

            // Zapisz wynik ponownego losowania
            const rerollResult = {
                lotteryId: originalResult.lotteryId + '_reroll',
                lotteryName: originalResult.lotteryName + ' (Ponowne losowanie)',
                originalDate: originalResult.date,
                rerollDate: new Date().toISOString(),
                originalParticipantCount: originalResult.participantCount,
                rerollParticipantCount: eligibleForReroll.length,
                originalWinners: originalResult.winners,
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