const fs = require('fs').promises;
const path = require('path');
const cron = require('node-cron');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class RoleKickingService {
    constructor(config) {
        this.config = config;
        this.client = null;
        this.cronJob = null;
        this.rekruterDataPath = path.resolve(this.config.roleKicking.rekruterDataPath);
    }

    /**
     * Inicjalizuje serwis kickowania
     * @param {Client} client - Klient Discord
     */
    async initialize(client) {
        this.client = client;
        
        if (this.config.roleKicking.enabled) {
            this.startCronJob();
            logger.info('Serwis kickowania użytkowników bez ról został zainicjalizowany');
        }
    }

    /**
     * Uruchamia zadanie cron
     */
    startCronJob() {
        if (this.cronJob) {
            this.cronJob.destroy();
        }

        this.cronJob = cron.schedule(this.config.roleKicking.checkInterval, () => {
            this.checkAndKickUsers();
        });

        logger.info(`Zadanie cron kickowania uruchomione: ${this.config.roleKicking.checkInterval}`);
    }

    /**
     * Zatrzymuje zadanie cron
     */
    stopCronJob() {
        if (this.cronJob) {
            this.cronJob.destroy();
            this.cronJob = null;
            logger.info('Zadanie cron kickowania zatrzymane');
        }
    }

    /**
     * Sprawdza i kickuje użytkowników bez ról
     * @param {boolean} dryRun - Czy tylko symulować (nie kickować rzeczywiście)
     */
    async checkAndKickUsers(dryRun = false) {
        try {
            logger.info('🔍 Rozpoczynam sprawdzanie użytkowników do kickowania...');
            const rekruterData = await this.loadRekruterData();
            if (!rekruterData) {
                logger.info('❌ Brak danych Rekrutera - przerywam sprawdzanie');
                return;
            }

            const usersToKick = this.getUsersForKick(rekruterData);
            logger.info(`📋 Znaleziono ${usersToKick.length} użytkowników do kickowania`);

            if (usersToKick.length === 0) {
                logger.info('✅ Brak użytkowników do kickowania');
                return;
            }

            for (const userData of usersToKick) {
                await this.kickUser(userData, dryRun);
                await this.delay(1000); // Opóźnienie między kickami
            }

            // Aktualizuj dane Rekrutera po kickach (tylko w trybie produkcyjnym)
            if (usersToKick.length > 0 && !dryRun) {
                await this.updateRekruterData(rekruterData, usersToKick);
            }
        } catch (error) {
            logger.error(`Błąd podczas kickowania użytkowników: ${error.message}`);
        }
    }

    /**
     * Ładuje dane z pliku Rekrutera
     * @returns {Object|null} - Dane monitorowania lub null
     */
    async loadRekruterData() {
        try {
            logger.info(`Próba ładowania danych Rekrutera z: ${this.rekruterDataPath}`);
            const data = await fs.readFile(this.rekruterDataPath, 'utf8');
            const parsedData = JSON.parse(data);
            logger.info(`Załadowano dane Rekrutera - znaleziono ${Object.keys(parsedData).length} użytkowników do monitorowania`);
            return parsedData;
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.warn(`Plik danych Rekrutera nie istnieje: ${this.rekruterDataPath}`);
            } else {
                logger.error(`Błąd ładowania danych Rekrutera: ${error.message}`);
            }
            return null;
        }
    }

    /**
     * Zapisuje zaktualizowane dane do pliku Rekrutera
     * @param {Object} rekruterData - Dane do zapisu
     * @param {Array} kickedUsers - Lista kickniętych użytkowników
     */
    async updateRekruterData(rekruterData, kickedUsers) {
        try {
            // Usuń kickniętych użytkowników z danych
            for (const user of kickedUsers) {
                delete rekruterData[user.userId];
            }

            await fs.writeFile(this.rekruterDataPath, JSON.stringify(rekruterData, null, 2));
            logger.info(`Zaktualizowano dane Rekrutera - usunięto ${kickedUsers.length} użytkowników`);
        } catch (error) {
            logger.error(`Błąd aktualizacji danych Rekrutera: ${error.message}`);
        }
    }

    /**
     * Pobiera użytkowników gotowych do kicka (48h bez ról)
     * @param {Object} rekruterData - Dane z Rekrutera
     * @returns {Array} - Lista użytkowników do kicka
     */
    getUsersForKick(rekruterData) {
        const now = Date.now();
        const kick48h = 48 * 60 * 60 * 1000; // 48 godzin w ms
        const usersToKick = [];

        logger.info(`🕐 Sprawdzanie użytkowników - obecny czas: ${new Date(now).toISOString()}`);
        logger.info(`⏰ Próg kickowania: ${kick48h / (60 * 60 * 1000)}h = ${kick48h}ms`);

        for (const [userId, userData] of Object.entries(rekruterData)) {
            const timeSinceJoin = now - userData.joinedAt;
            const hoursWaiting = (timeSinceJoin / (60 * 60 * 1000)).toFixed(1);
            
            logger.info(`👤 Użytkownik ${userId}: czeka ${hoursWaiting}h (${timeSinceJoin}ms od ${new Date(userData.joinedAt).toISOString()})`);
            
            if (timeSinceJoin >= kick48h) {
                logger.info(`🎯 Użytkownik ${userId} kwalifikuje się do kicka`);
                usersToKick.push({
                    userId,
                    guildId: userData.guildId,
                    joinedAt: userData.joinedAt,
                    timeSinceJoin,
                    warned24h: userData.warned24h
                });
            }
        }

        return usersToKick;
    }

    /**
     * Kickuje konkretnego użytkownika
     * @param {Object} userData - Dane użytkownika do kicka
     * @param {boolean} dryRun - Czy tylko symulować (nie kickować rzeczywiście)
     */
    async kickUser(userData, dryRun = false) {
        try {
            const guild = this.client.guilds.cache.get(userData.guildId);
            if (!guild) {
                logger.error(`Nie znaleziono serwera: ${userData.guildId}`);
                return;
            }

            const member = await guild.members.fetch(userData.userId).catch(() => null);
            if (!member) {
                logger.info(`Użytkownik ${userData.userId} już nie jest na serwerze`);
                return;
            }

            // Sprawdź czy nadal nie ma ról (ostatnia kontrola)
            const hasRoles = member.roles.cache.size > 1;
            const roleNames = member.roles.cache.map(role => role.name).filter(name => name !== '@everyone');
            
            logger.info(`🔍 Sprawdzanie ról użytkownika ${member.user.tag}:`);
            logger.info(`📊 Liczba ról: ${member.roles.cache.size} (włączając @everyone)`);
            logger.info(`📝 Role: ${roleNames.length > 0 ? roleNames.join(', ') : 'Brak ról poza @everyone'}`);
            
            if (hasRoles) {
                logger.info(`✅ Użytkownik ${member.user.tag} ma role - anulowanie kicka`);
                // Usuń z monitorowania Rekrutera, skoro ma role
                if (!dryRun) {
                    await this.removeFromRekruterData(userData.userId);
                }
                return;
            }

            if (dryRun) {
                logger.info(`🧪 SYMULACJA: Użytkownik ${member.user.tag} zostałby kicknięty za 48h bez ról`);
                logger.info(`📋 Powód: Automatyczny kick - 48h bez wypełnienia ankiety rekrutacyjnej`);
                return;
            }

            // Wyślij wiadomość przed kickiem
            await this.sendKickNotification(member, userData);

            // Kicknij użytkownika
            const reason = `Automatyczny kick - 48h bez wypełnienia ankiety rekrutacyjnej`;
            await member.kick(reason);

            logger.info(`✅ Kicknięto ${member.user.tag} (${userData.userId}) - 48h bez ról`);
        } catch (error) {
            logger.error(`❌ Błąd kickowania użytkownika ${userData.userId}: ${error.message}`);
        }
    }

    /**
     * Wysyła powiadomienie o kicku
     * @param {GuildMember} member - Członek serwera
     * @param {Object} userData - Dane użytkownika
     */
    async sendKickNotification(member, userData) {
        try {
            const timeText = this.formatTime(userData.timeSinceJoin);
            
            const kickMessage = `🚨 **Automatyczny kick z serwera** 🚨

Witaj ${member.user.username}!

Zostałeś usunięty z serwera **${member.guild.name}** z następującego powodu:

⏰ **Czas na serwerze bez wypełnienia ankiety:** ${timeText}
📋 **Nie wypełniłeś ankiety rekrutacyjnej w ciągu 48 godzin**

${userData.warned24h ? '⚠️ **Otrzymałeś ostrzeżenie po 24 godzinach**' : ''}

❓ **W razie pytań możesz skontaktować się z właścicielem serwera.**

Możesz ponownie dołączyć do serwera i wypełnić ankietę rekrutacyjną.

Pozdrawiamy,
Bot Muteusz`;

            await member.send(kickMessage);
            logger.info(`📨 Wysłano powiadomienie o kicku do ${member.user.tag}`);
        } catch (error) {
            logger.error(`❌ Nie można wysłać powiadomienia o kicku do ${member.user.tag}: ${error.message}`);
        }
    }

    /**
     * Formatuje czas do czytelnej formy
     * @param {number} milliseconds - Czas w milisekundach
     * @returns {string} - Sformatowany czas
     */
    formatTime(milliseconds) {
        const hours = Math.floor(milliseconds / (1000 * 60 * 60));
        const days = Math.floor(hours / 24);
        
        if (days > 0) {
            const remainingHours = hours % 24;
            return `${days} dni ${remainingHours} godzin`;
        } else {
            return `${hours} godzin`;
        }
    }

    /**
     * Opóźnienie
     * @param {number} ms - Milisekundy
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Usuwa użytkownika z danych Rekrutera (gdy otrzyma role)
     * @param {string} userId - ID użytkownika do usunięcia
     */
    async removeFromRekruterData(userId) {
        try {
            const rekruterData = await this.loadRekruterData();
            if (rekruterData && rekruterData[userId]) {
                delete rekruterData[userId];
                await fs.writeFile(this.rekruterDataPath, JSON.stringify(rekruterData, null, 2));
                logger.info(`🗑️ Usunięto użytkownika ${userId} z monitorowania Rekrutera`);
            }
        } catch (error) {
            logger.error(`Błąd podczas usuwania użytkownika z danych Rekrutera: ${error.message}`);
        }
    }

    /**
     * Zatrzymuje serwis
     */
    stop() {
        this.stopCronJob();
        logger.info('Serwis kickowania użytkowników został zatrzymany');
    }

    /**
     * Metoda testowa do ręcznego wywołania sprawdzenia (tylko symulacja)
     * @param {boolean} dryRun - Czy tylko symulować (nie kickować)
     */
    async manualCheck(dryRun = true) {
        logger.info(`🧪 Ręczne wywołanie sprawdzania użytkowników... ${dryRun ? '(TRYB TESTOWY - BEZ KICKANIA)' : '(TRYB PRODUKCYJNY)'}`);
        await this.checkAndKickUsers(dryRun);
    }
}

module.exports = RoleKickingService;