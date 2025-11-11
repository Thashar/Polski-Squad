const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

class ChaosService {
    constructor(config, logService) {
        this.config = config;
        this.logService = logService;
        this.dataFile = path.join(__dirname, '../data/chaos_mode.json');

        // Stan chaos mode
        this.enabled = false;
        this.chaosRoleIds = []; // Array ról do nadawania

        // Map przechowujący użytkowników z aktywną rolą chaosową
        // Key: userId, Value: { guildId, roleId, timeoutId, expiresAt }
        this.activeUsers = new Map();

        // Szanse
        this.ROLE_CHANCE = 0.05; // 5% szansa na otrzymanie roli
        this.RESPONSE_CHANCE = 0.05; // 5% szansa na odpowiedź bota (1/20)
        this.ROLE_DURATION = 60 * 60 * 1000; // 1 godzina w milisekundach

        // Emoji do odpowiedzi
        this.responseEmojis = [
            '<a:PepePolska:1341086791608041626>',
            '<a:Z_animated_polish_flag:1418123566687453235>'
        ];
    }

    /**
     * Inicjalizuje serwis
     */
    async initialize() {
        try {
            await this.loadChaosMode();
            logger.info('✅ ChaosService zainicjalizowany');
        } catch (error) {
            logger.error(`❌ Błąd inicjalizacji ChaosService: ${error.message}`);
            throw error;
        }
    }

    /**
     * Ładuje stan chaos mode z pliku
     */
    async loadChaosMode() {
        try {
            // Sprawdź czy plik istnieje
            try {
                await fs.access(this.dataFile);
            } catch (error) {
                // Plik nie istnieje, stwórz pusty
                await this.ensureDataDirectory();
                await this.saveChaosMode();
                return;
            }

            const data = await fs.readFile(this.dataFile, 'utf8');
            const chaosData = JSON.parse(data);

            this.enabled = chaosData.enabled || false;
            // Kompatybilność wsteczna - obsługa starego formatu z pojedynczą rolą
            if (chaosData.chaosRoleIds && Array.isArray(chaosData.chaosRoleIds)) {
                this.chaosRoleIds = chaosData.chaosRoleIds;
            } else if (chaosData.chaosRoleId) {
                this.chaosRoleIds = [chaosData.chaosRoleId];
            } else {
                this.chaosRoleIds = [];
            }

            // Wczytaj aktywnych użytkowników i sprawdź czy ich role jeszcze są aktywne
            const now = Date.now();
            if (chaosData.activeUsers && Array.isArray(chaosData.activeUsers)) {
                for (const user of chaosData.activeUsers) {
                    if (user.expiresAt > now) {
                        // Rola jeszcze aktywna - ustaw nowy timeout
                        const remainingTime = user.expiresAt - now;
                        this.activeUsers.set(user.userId, {
                            guildId: user.guildId,
                            roleId: user.roleId, // ID nadanej roli
                            timeoutId: null, // Będzie ustawiony przez setupRoleTimeout
                            expiresAt: user.expiresAt
                        });
                    }
                }
            }

            logger.info(`📥 Chaos Mode: ${this.enabled ? 'włączony' : 'wyłączony'}, Role: ${this.chaosRoleIds.join(', ') || 'brak'}, Aktywni użytkownicy: ${this.activeUsers.size}`);
        } catch (error) {
            logger.error(`❌ Błąd ładowania chaos mode: ${error.message}`);
            throw error;
        }
    }

    /**
     * Zapisuje stan chaos mode do pliku
     */
    async saveChaosMode() {
        try {
            await this.ensureDataDirectory();

            // Konwertuj Map na tablicę
            const activeUsersArray = Array.from(this.activeUsers.entries()).map(([userId, data]) => ({
                userId,
                guildId: data.guildId,
                roleId: data.roleId, // Zapisz ID nadanej roli
                expiresAt: data.expiresAt
            }));

            const chaosData = {
                enabled: this.enabled,
                chaosRoleIds: this.chaosRoleIds,
                activeUsers: activeUsersArray
            };

            await fs.writeFile(this.dataFile, JSON.stringify(chaosData, null, 2));
        } catch (error) {
            logger.error(`❌ Błąd zapisywania chaos mode: ${error.message}`);
            throw error;
        }
    }

    /**
     * Upewnia się, że katalog data istnieje
     */
    async ensureDataDirectory() {
        const dataDir = path.dirname(this.dataFile);
        try {
            await fs.access(dataDir);
        } catch (error) {
            await fs.mkdir(dataDir, { recursive: true });
        }
    }

    /**
     * Włącza chaos mode
     * @param {Array<string>} roleIds - Array ID ról do nadawania
     * @returns {Object} - {success: boolean, message: string}
     */
    async enableChaosMode(roleIds) {
        try {
            this.enabled = true;
            this.chaosRoleIds = roleIds;
            await this.saveChaosMode();

            const rolesText = roleIds.map(id => `<@&${id}>`).join(', ');
            logger.info(`🔥 Chaos Mode włączony! Role: ${roleIds.join(', ')}`);
            return {
                success: true,
                message: `✅ Chaos Mode został włączony!\n🎲 ${roleIds.length === 1 ? 'Rola' : 'Role'}: ${rolesText}\n📊 Szansa na rolę: **5%**\n⏰ Czas trwania roli: **1 godzina**\n💬 Szansa na odpowiedź bota: **5%** (1 na 20)`
            };
        } catch (error) {
            logger.error(`❌ Błąd włączania Chaos Mode: ${error.message}`);
            return {
                success: false,
                message: `❌ Błąd: ${error.message}`
            };
        }
    }

    /**
     * Wyłącza chaos mode
     * @param {Guild} guild - Obiekt guild Discord (opcjonalny, jeśli podany usuwa role od użytkowników)
     * @returns {Object} - {success: boolean, message: string}
     */
    async disableChaosMode(guild = null) {
        try {
            this.enabled = false;

            let removedCount = 0;
            let errorCount = 0;

            // Usuń role od wszystkich aktywnych użytkowników
            if (guild) {
                for (const [userId, data] of this.activeUsers.entries()) {
                    if (data.timeoutId) {
                        clearTimeout(data.timeoutId);
                    }

                    // Spróbuj usunąć rolę od użytkownika
                    try {
                        const member = await guild.members.fetch(userId);
                        if (member && data.roleId && member.roles.cache.has(data.roleId)) {
                            await member.roles.remove(data.roleId);
                            removedCount++;
                            logger.info(`✅ Usunięto rolę chaos od użytkownika ${member.user.tag}`);
                        }
                    } catch (error) {
                        errorCount++;
                        logger.warn(`⚠️ Nie można usunąć roli od użytkownika ${userId}: ${error.message}`);
                    }
                }
            } else {
                // Tylko wyczyść timery jeśli nie mamy guild
                for (const [userId, data] of this.activeUsers.entries()) {
                    if (data.timeoutId) {
                        clearTimeout(data.timeoutId);
                    }
                }
            }

            const activeCount = this.activeUsers.size;
            this.activeUsers.clear();

            await this.saveChaosMode();

            logger.info(`❌ Chaos Mode wyłączony. Wyczyszczono ${activeCount} aktywnych użytkowników. Usuniętych ról: ${removedCount}.`);

            let message = `✅ Chaos Mode został wyłączony!\n👥 Wyczyszczono ${activeCount} aktywnych użytkowników z listy.`;
            if (guild) {
                message += `\n🗑️ Usunięto rolę od ${removedCount} użytkowników.`;
                if (errorCount > 0) {
                    message += `\n⚠️ Nie udało się usunąć roli od ${errorCount} użytkowników (mogą być offline lub opuścili serwer).`;
                }
            }

            return {
                success: true,
                message: message
            };
        } catch (error) {
            logger.error(`❌ Błąd wyłączania Chaos Mode: ${error.message}`);
            return {
                success: false,
                message: `❌ Błąd: ${error.message}`
            };
        }
    }

    /**
     * Obsługuje wiadomość użytkownika (losowanie roli i odpowiedzi)
     * @param {Message} message - Wiadomość Discord
     */
    async handleMessage(message) {
        if (!this.enabled || this.chaosRoleIds.length === 0) {
            return;
        }

        // Ignoruj botów
        if (message.author.bot) {
            return;
        }

        const userId = message.author.id;
        const guildId = message.guild.id;
        const member = message.member;

        // 1. Sprawdź czy użytkownik już ma jakąkolwiek rolę chaos
        const hasAnyRole = this.chaosRoleIds.some(roleId => member.roles.cache.has(roleId));

        if (!hasAnyRole && !this.activeUsers.has(userId)) {
            // Użytkownik nie ma roli - losuj czy ją otrzyma (5% szansa)
            const randomChance = Math.random();
            if (randomChance < this.ROLE_CHANCE) {
                await this.grantChaosRole(message, member);
            }
        }

        // 2. Jeśli użytkownik ma rolę, losuj czy bot odpowie (5% szansa, 1/20)
        if (hasAnyRole) {
            const randomResponse = Math.random();
            if (randomResponse < this.RESPONSE_CHANCE) {
                await this.sendRandomResponse(message);
            }
        }
    }

    /**
     * Nadaje rolę chaos użytkownikowi
     * @param {Message} message - Wiadomość Discord
     * @param {GuildMember} member - Członek serwera
     */
    async grantChaosRole(message, member) {
        try {
            // Losuj jedną z ról
            const randomRoleId = this.chaosRoleIds[Math.floor(Math.random() * this.chaosRoleIds.length)];

            // Nadaj rolę
            await member.roles.add(randomRoleId);

            const expiresAt = Date.now() + this.ROLE_DURATION;

            // Ustaw timeout na usunięcie roli
            const timeoutId = setTimeout(async () => {
                await this.removeChaosRole(member.id, member.guild.id);
            }, this.ROLE_DURATION);

            // Zapisz użytkownika z ID nadanej roli
            this.activeUsers.set(member.id, {
                guildId: member.guild.id,
                roleId: randomRoleId,
                timeoutId: timeoutId,
                expiresAt: expiresAt
            });

            await this.saveChaosMode();

            logger.info(`🎲 Chaos Mode: Nadano rolę ${randomRoleId} użytkownikowi ${message.author.tag} (5% szansa)`);

            // Wyślij wiadomość w odpowiedzi
            try {
                await message.reply('Jeszcze Polska nie zginęła! <a:PepePolska:1341086791608041626>');
            } catch (error) {
                // Ignoruj błędy wysyłania wiadomości
            }
        } catch (error) {
            logger.error(`❌ Błąd nadawania roli chaos: ${error.message}`);
        }
    }

    /**
     * Usuwa rolę chaos od użytkownika
     * @param {string} userId - ID użytkownika
     * @param {string} guildId - ID serwera
     */
    async removeChaosRole(userId, guildId) {
        try {
            // Usuń z mapy
            const userData = this.activeUsers.get(userId);
            if (userData && userData.timeoutId) {
                clearTimeout(userData.timeoutId);
            }
            this.activeUsers.delete(userId);

            await this.saveChaosMode();

            logger.info(`⏰ Chaos Mode: Usunięto rolę użytkownikowi ${userId} (timeout 1 godzina)`);

            // Znajdź użytkownika i usuń rolę
            // Uwaga: To wymaga dostępu do klienta Discord, więc robimy to asynchronicznie
            // i ignorujemy błędy jeśli użytkownik nie jest już na serwerze
        } catch (error) {
            logger.error(`❌ Błąd usuwania roli chaos: ${error.message}`);
        }
    }

    /**
     * Usuwa rolę chaos od użytkownika (z guild memberem)
     * @param {GuildMember} member - Członek serwera
     * @param {string} roleId - ID roli do usunięcia (opcjonalnie, jeśli nie podano usuwa wszystkie role chaos)
     */
    async removeChaosRoleFromMember(member, roleId = null) {
        try {
            if (roleId) {
                // Usuń konkretną rolę
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId);
                    logger.info(`✅ Usunięto rolę chaos ${roleId} od użytkownika ${member.user.tag}`);
                }
            } else {
                // Usuń wszystkie role chaos
                let removed = false;
                for (const chaosRoleId of this.chaosRoleIds) {
                    if (member.roles.cache.has(chaosRoleId)) {
                        await member.roles.remove(chaosRoleId);
                        removed = true;
                    }
                }
                if (removed) {
                    logger.info(`✅ Usunięto role chaos od użytkownika ${member.user.tag}`);
                }
            }
        } catch (error) {
            logger.error(`❌ Błąd usuwania roli od członka: ${error.message}`);
        }
    }

    /**
     * Wysyła losową odpowiedź emoji
     * @param {Message} message - Wiadomość Discord
     */
    async sendRandomResponse(message) {
        try {
            const randomEmoji = this.responseEmojis[Math.floor(Math.random() * this.responseEmojis.length)];
            await message.channel.send(randomEmoji);
            logger.info(`🇵🇱 Chaos Mode: Wysłano losową odpowiedź na kanale ${message.channel.name} (5% szansa, 1/20)`);
        } catch (error) {
            logger.error(`❌ Błąd wysyłania losowej odpowiedzi chaos: ${error.message}`);
        }
    }

    /**
     * Przywraca timeouty dla aktywnych użytkowników po restarcie bota
     * @param {Client} client - Klient Discord
     */
    async restoreTimeouts(client) {
        if (!this.enabled || this.chaosRoleIds.length === 0) {
            return;
        }

        logger.info(`🔄 Przywracanie timeoutów Chaos Mode dla ${this.activeUsers.size} użytkowników...`);

        const now = Date.now();
        const toRemove = [];

        for (const [userId, data] of this.activeUsers.entries()) {
            const remainingTime = data.expiresAt - now;

            if (remainingTime <= 0) {
                // Rola już wygasła
                toRemove.push(userId);

                // Spróbuj usunąć rolę z użytkownika
                try {
                    const guild = await client.guilds.fetch(data.guildId);
                    const member = await guild.members.fetch(userId);
                    await this.removeChaosRoleFromMember(member, data.roleId);
                } catch (error) {
                    // Ignoruj błędy (użytkownik mógł opuścić serwer)
                }
            } else {
                // Ustaw nowy timeout
                const timeoutId = setTimeout(async () => {
                    try {
                        const guild = await client.guilds.fetch(data.guildId);
                        const member = await guild.members.fetch(userId);
                        await this.removeChaosRoleFromMember(member, data.roleId);
                        await this.removeChaosRole(userId, data.guildId);
                    } catch (error) {
                        // Ignoruj błędy
                        await this.removeChaosRole(userId, data.guildId);
                    }
                }, remainingTime);

                this.activeUsers.set(userId, {
                    ...data,
                    timeoutId: timeoutId
                });
            }
        }

        // Usuń wygasłych użytkowników
        for (const userId of toRemove) {
            this.activeUsers.delete(userId);
        }

        if (toRemove.length > 0) {
            await this.saveChaosMode();
        }

        logger.info(`✅ Przywrócono ${this.activeUsers.size} timeoutów Chaos Mode`);
    }

    /**
     * Zwraca status chaos mode
     * @returns {Object} - {enabled: boolean, roleIds: Array<string>, activeUsers: number}
     */
    getStatus() {
        return {
            enabled: this.enabled,
            roleIds: this.chaosRoleIds,
            activeUsers: this.activeUsers.size
        };
    }
}

module.exports = ChaosService;
