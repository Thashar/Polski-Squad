const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Rekruter');

class RoleMonitoringService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.cronJob = null;
        this.monitoringData = {};
        this.dataPath = path.resolve(this.config.roleMonitoring.dataFile);
    }

    /**
     * Inicjalizuje serwis monitorowania ról
     * @param {Client} client - Klient Discord
     */
    async initialize(client) {
        this.client = client;
        await this.loadMonitoringData();
        
        if (this.config.roleMonitoring.enabled) {
            this.startCronJob();
            logger.info('Serwis monitorowania ról został zainicjalizowany');
        }
    }

    /**
     * Ładuje dane monitorowania z pliku
     */
    async loadMonitoringData() {
        try {
            // Utwórz katalog jeśli nie istnieje
            await fs.mkdir(path.dirname(this.dataPath), { recursive: true });

            const data = await fs.readFile(this.dataPath, 'utf8');

            // Obsługa pustych plików (np. gdy brakło miejsca na dysku podczas zapisu)
            if (!data || data.trim() === '') {
                this.monitoringData = {};
                return;
            }

            this.monitoringData = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.error(`Błąd ładowania danych monitorowania: ${error.message}`);
            }
            this.monitoringData = {};
        }
    }

    /**
     * Zapisuje dane monitorowania do pliku
     */
    async saveMonitoringData() {
        try {
            await fs.writeFile(this.dataPath, JSON.stringify(this.monitoringData, null, 2));
        } catch (error) {
            logger.error(`Błąd zapisu danych monitorowania: ${error.message}`);
        }
    }

    /**
     * Uruchamia zadanie cron
     */
    startCronJob() {
        if (this.cronJob) {
            this.cronJob.destroy();
        }

        this.cronJob = cron.schedule(this.config.roleMonitoring.checkInterval, () => {
            this.checkUsersWithoutRoles();
        });

        logger.info(`Zadanie cron uruchomione: ${this.config.roleMonitoring.checkInterval}`);
    }

    /**
     * Zatrzymuje zadanie cron
     */
    stopCronJob() {
        if (this.cronJob) {
            this.cronJob.destroy();
            this.cronJob = null;
            logger.info('Zadanie cron zatrzymane');
        }
    }

    /**
     * Sprawdza użytkowników bez ról na serwerze
     */
    async checkUsersWithoutRoles() {
        try {
            logger.info('Rozpoczynam sprawdzanie użytkowników bez ról...');
            
            const guilds = this.client.guilds.cache;
            for (const [guildId, guild] of guilds) {
                await this.processGuild(guild);
            }
            
            await this.saveMonitoringData();
            logger.info('Zakończono sprawdzanie użytkowników bez ról');
        } catch (error) {
            logger.error(`Błąd podczas sprawdzania użytkowników: ${error.message}`);
        }
    }

    /**
     * Przetwarza konkretny serwer
     * @param {Guild} guild - Serwer Discord
     */
    async processGuild(guild) {
        try {
            const members = await guild.members.fetch();
            const now = Date.now();

            for (const [userId, member] of members) {
                // Pomiń boty
                if (member.user.bot) continue;

                // Sprawdź czy ma jakiekolwiek role (poza @everyone)
                const hasRoles = member.roles.cache.size > 1;

                if (!hasRoles) {
                    await this.handleUserWithoutRoles(guild, member, now);
                } else {
                    // Usuń z monitorowania jeśli ma role
                    if (this.monitoringData[userId]) {
                        delete this.monitoringData[userId];
                        logger.info(`Usunięto ${member.user.tag} z monitorowania - otrzymał role`);
                    }
                }
            }
        } catch (error) {
            logger.error(`Błąd przetwarzania serwera ${guild.name}: ${error.message}`);
        }
    }

    /**
     * Obsługuje użytkownika bez ról
     * @param {Guild} guild - Serwer Discord
     * @param {GuildMember} member - Członek serwera
     * @param {number} now - Aktualny timestamp
     */
    async handleUserWithoutRoles(guild, member, now) {
        const userId = member.user.id;
        const userData = this.monitoringData[userId];

        if (!userData) {
            // Nowy użytkownik bez ról - rozpocznij monitorowanie
            this.monitoringData[userId] = {
                joinedAt: member.joinedTimestamp || now,
                firstDetected: now,
                warned24h: false,
                guildId: guild.id
            };
            logger.info(`Rozpoczęto monitorowanie ${member.user.tag} - bez ról od ${new Date(now).toISOString()}`);
            return;
        }

        const timeSinceJoin = now - userData.joinedAt;
        const warning24h = this.config.roleMonitoring.warning24Hours;

        // Sprawdź czy minęło 24h i nie wysłano ostrzeżenia
        if (timeSinceJoin >= warning24h && !userData.warned24h) {
            await this.send24hWarning(member);
            userData.warned24h = true;
            logger.info(`Wysłano ostrzeżenie 24h do ${member.user.tag}`);
        }
    }

    /**
     * Wysyła ostrzeżenie po 24h
     * @param {GuildMember} member - Członek serwera
     */
    async send24hWarning(member) {
        try {
            const warningMessage = `🚨 **Ostrzeżenie** 🚨

Witaj ${member.user.username}!

Od **24 godzin** nie wypełniłeś ankiety na kanale **${this.config.roleMonitoring.waitingRoomChannel}** na serwerze **${member.guild.name}**.

📋 **Dopiero po wypełnieniu ankiety otrzymasz dostęp do serwera.**

⚠️ **Jeżeli przez następne 24 godziny ankieta nie zostanie wypełniona, otrzymasz kick z serwera.**

❓ **W razie pytań możesz skontaktować się z właścicielem serwera.**

Pozdrawiamy,
Bot Rekruter`;

            await member.send(warningMessage);
            logger.info(`✅ Wysłano ostrzeżenie 24h do ${member.user.tag}`);
        } catch (error) {
            logger.error(`❌ Nie można wysłać wiadomości do ${member.user.tag}: ${error.message}`);
        }
    }

    /**
     * Pobiera użytkowników gotowych do kicka (48h bez ról)
     * @returns {Array} - Lista użytkowników do kicka
     */
    getUsersForKick() {
        const now = Date.now();
        const kick48h = this.config.roleMonitoring.warning24Hours * 2; // 48h
        const usersToKick = [];

        for (const [userId, userData] of Object.entries(this.monitoringData)) {
            const timeSinceJoin = now - userData.joinedAt;
            
            if (timeSinceJoin >= kick48h) {
                usersToKick.push({
                    userId,
                    guildId: userData.guildId,
                    joinedAt: userData.joinedAt,
                    timeSinceJoin
                });
            }
        }

        return usersToKick;
    }

    /**
     * Usuwa użytkownika z monitorowania
     * @param {string} userId - ID użytkownika
     */
    removeUserFromMonitoring(userId) {
        if (this.monitoringData[userId]) {
            delete this.monitoringData[userId];
            this.saveMonitoringData();
        }
    }

    /**
     * Zatrzymuje serwis
     */
    stop() {
        this.stopCronJob();
        logger.info('Serwis monitorowania ról został zatrzymany');
    }
}

module.exports = RoleMonitoringService;