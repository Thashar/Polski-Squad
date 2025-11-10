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
        this.chaosRoleId = null;

        // Map przechowujący użytkowników z aktywną rolą chaosową
        // Key: userId, Value: { guildId, timeoutId, expiresAt }
        this.activeUsers = new Map();

        // Szanse
        this.ROLE_CHANCE = 0.10; // 10% szansa na otrzymanie roli
        this.RESPONSE_CHANCE = 0.01; // 1% szansa na odpowiedź bota
        this.ROLE_DURATION = 15 * 60 * 1000; // 15 minut w milisekundach

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
            this.chaosRoleId = chaosData.chaosRoleId || null;

            // Wczytaj aktywnych użytkowników i sprawdź czy ich role jeszcze są aktywne
            const now = Date.now();
            if (chaosData.activeUsers && Array.isArray(chaosData.activeUsers)) {
                for (const user of chaosData.activeUsers) {
                    if (user.expiresAt > now) {
                        // Rola jeszcze aktywna - ustaw nowy timeout
                        const remainingTime = user.expiresAt - now;
                        this.activeUsers.set(user.userId, {
                            guildId: user.guildId,
                            timeoutId: null, // Będzie ustawiony przez setupRoleTimeout
                            expiresAt: user.expiresAt
                        });
                    }
                }
            }

            logger.info(`📥 Chaos Mode: ${this.enabled ? 'włączony' : 'wyłączony'}, Rola: ${this.chaosRoleId || 'brak'}, Aktywni użytkownicy: ${this.activeUsers.size}`);
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
                expiresAt: data.expiresAt
            }));

            const chaosData = {
                enabled: this.enabled,
                chaosRoleId: this.chaosRoleId,
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
     * @param {string} roleId - ID roli do nadawania
     * @returns {Object} - {success: boolean, message: string}
     */
    async enableChaosMode(roleId) {
        try {
            this.enabled = true;
            this.chaosRoleId = roleId;
            await this.saveChaosMode();

            logger.info(`🔥 Chaos Mode włączony! Rola: ${roleId}`);
            return {
                success: true,
                message: `✅ Chaos Mode został włączony!\n🎲 Rola: <@&${roleId}>\n📊 Szansa na rolę: **10%**\n⏰ Czas trwania roli: **15 minut**\n💬 Szansa na odpowiedź bota: **1%**`
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
     * @returns {Object} - {success: boolean, message: string}
     */
    async disableChaosMode() {
        try {
            this.enabled = false;

            // Wyczyść wszystkie timery
            for (const [userId, data] of this.activeUsers.entries()) {
                if (data.timeoutId) {
                    clearTimeout(data.timeoutId);
                }
            }

            const activeCount = this.activeUsers.size;
            this.activeUsers.clear();

            await this.saveChaosMode();

            logger.info(`❌ Chaos Mode wyłączony. Wyczyszczono ${activeCount} aktywnych użytkowników.`);
            return {
                success: true,
                message: `✅ Chaos Mode został wyłączony!\n👥 Wyczyszczono ${activeCount} aktywnych użytkowników z rolą.`
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
        if (!this.enabled || !this.chaosRoleId) {
            return;
        }

        // Ignoruj botów
        if (message.author.bot) {
            return;
        }

        const userId = message.author.id;
        const guildId = message.guild.id;
        const member = message.member;

        // 1. Sprawdź czy użytkownik już ma rolę chaos
        const hasRole = member.roles.cache.has(this.chaosRoleId);

        if (!hasRole && !this.activeUsers.has(userId)) {
            // Użytkownik nie ma roli - losuj czy ją otrzyma (10% szansa)
            const randomChance = Math.random();
            if (randomChance < this.ROLE_CHANCE) {
                await this.grantChaosRole(message, member);
            }
        }

        // 2. Jeśli użytkownik ma rolę, losuj czy bot odpowie (1% szansa)
        if (hasRole) {
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
            // Nadaj rolę
            await member.roles.add(this.chaosRoleId);

            const expiresAt = Date.now() + this.ROLE_DURATION;

            // Ustaw timeout na usunięcie roli
            const timeoutId = setTimeout(async () => {
                await this.removeChaosRole(member.id, member.guild.id);
            }, this.ROLE_DURATION);

            // Zapisz użytkownika
            this.activeUsers.set(member.id, {
                guildId: member.guild.id,
                timeoutId: timeoutId,
                expiresAt: expiresAt
            });

            await this.saveChaosMode();

            logger.info(`🎲 Chaos Mode: Nadano rolę użytkownikowi ${message.author.tag} (10% szansa)`);

            // Opcjonalnie: wyślij wiadomość do użytkownika
            try {
                await message.reply('🎲 **Chaos Mode aktywowany!** Otrzymałeś specjalną rolę na 15 minut! 🔥');
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

            logger.info(`⏰ Chaos Mode: Usunięto rolę użytkownikowi ${userId} (timeout 15 minut)`);

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
     */
    async removeChaosRoleFromMember(member) {
        try {
            if (member.roles.cache.has(this.chaosRoleId)) {
                await member.roles.remove(this.chaosRoleId);
                logger.info(`✅ Usunięto rolę chaos od użytkownika ${member.user.tag}`);
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
            await message.reply(randomEmoji);
            logger.info(`🇵🇱 Chaos Mode: Wysłano losową odpowiedź do ${message.author.tag} (1% szansa)`);
        } catch (error) {
            logger.error(`❌ Błąd wysyłania losowej odpowiedzi chaos: ${error.message}`);
        }
    }

    /**
     * Przywraca timeouty dla aktywnych użytkowników po restarcie bota
     * @param {Client} client - Klient Discord
     */
    async restoreTimeouts(client) {
        if (!this.enabled || !this.chaosRoleId) {
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
                    await this.removeChaosRoleFromMember(member);
                } catch (error) {
                    // Ignoruj błędy (użytkownik mógł opuścić serwer)
                }
            } else {
                // Ustaw nowy timeout
                const timeoutId = setTimeout(async () => {
                    try {
                        const guild = await client.guilds.fetch(data.guildId);
                        const member = await guild.members.fetch(userId);
                        await this.removeChaosRoleFromMember(member);
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
     * @returns {Object} - {enabled: boolean, roleId: string|null, activeUsers: number}
     */
    getStatus() {
        return {
            enabled: this.enabled,
            roleId: this.chaosRoleId,
            activeUsers: this.activeUsers.size
        };
    }
}

module.exports = ChaosService;
