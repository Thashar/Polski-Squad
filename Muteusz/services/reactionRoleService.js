const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');

class ReactionRoleService {
    constructor(config) {
        this.config = config;
        this.logger = createBotLogger('Muteusz');
        
        // Mapa aktywnych timerów usuwania ról
        this.roleRemovalTimers = new Map();
        
        // Przechowuje dane o timerach dla persystencji
        this.persistentTimers = [];
        
        // Konfiguracja reakcji -> rola
        this.reactionRoleConfig = {
            'flag_ua': '1409530749937254470', // ID roli dla flagi ukrainy (:flag_ua:)
            '🇺🇦': '1409530749937254470', // ID roli dla flagi ukrainy (Unicode)
            'ua': '1409530749937254470' // ID roli dla flagi ukrainy (możliwe skrócenie)
        };
        
        // Czas trzymania roli w milisekundach (5 minut)
        this.roleHoldTime = 5 * 60 * 1000;
        
        // Ścieżka do pliku z aktywnymi timerami
        this.timersFilePath = path.join(__dirname, '../data/reaction_role_timers.json');
        
        // Klien Discord (zostanie ustawiony w initialize)
        this.client = null;
    }

    /**
     * Inicjalizuje serwis i przywraca timery z pliku
     */
    async initialize(client) {
        this.client = client;
        await this.restoreTimersFromFile();
    }

    /**
     * Ładuje i przywraca timery z pliku
     */
    async restoreTimersFromFile() {
        try {
            const data = await fs.readFile(this.timersFilePath, 'utf8');
            const timersData = JSON.parse(data);
            
            let restoredCount = 0;
            let expiredCount = 0;
            const currentTime = Date.now();
            const stillActiveTimers = [];
            
            for (const timerInfo of timersData) {
                const { userId, roleId, guildId, expiresAt } = timerInfo;
                
                // Sprawdź czy timer nie wygasł
                if (expiresAt <= currentTime) {
                    // Timer już wygasł - usuń rolę natychmiast
                    await this.removeRoleFromUser(userId, roleId, guildId, true);
                    expiredCount++;
                    continue;
                }
                
                // Oblicz pozostały czas
                const remainingTime = expiresAt - currentTime;
                
                // Ustaw timer na pozostały czas
                const timerKey = `${userId}-${roleId}`;
                const timer = setTimeout(async () => {
                    await this.removeRoleFromUser(userId, roleId, guildId, true);
                    await this.removeTimerFromPersistence(userId, roleId);
                }, remainingTime);
                
                this.roleRemovalTimers.set(timerKey, timer);
                stillActiveTimers.push(timerInfo);
                restoredCount++;
            }
            
            // Zaktualizuj listę aktywnych timerów
            this.persistentTimers = stillActiveTimers;
            await this.saveTimersToFile();
            
            this.logger.info(`🔄 Przywrócono ${restoredCount} timerów, usunięto ${expiredCount} wygasłych`);
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje - to normalne przy pierwszym uruchomieniu
                this.logger.info('📁 Plik timerów nie istnieje - będzie utworzony przy pierwszym użyciu');
                this.persistentTimers = [];
            } else {
                this.logger.error('❌ Błąd podczas przywracania timerów:', error);
                this.persistentTimers = [];
            }
        }
    }

    /**
     * Usuwa rolę od użytkownika
     */
    async removeRoleFromUser(userId, roleId, guildId, expired = false) {
        try {
            if (!this.client) {
                this.logger.error('❌ Klient Discord nie jest dostępny');
                return;
            }

            const guild = this.client.guilds.cache.get(guildId);
            if (!guild) {
                this.logger.error(`❌ Nie można znaleźć serwera o ID: ${guildId}`);
                return;
            }

            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) {
                this.logger.warn(`⚠️ Nie można znaleźć członka o ID: ${userId}`);
                return;
            }

            const role = guild.roles.cache.get(roleId);
            if (!role) {
                this.logger.error(`❌ Nie można znaleźć roli o ID: ${roleId}`);
                return;
            }

            if (member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
                const reason = expired ? 'po 5 minutach' : '(anulowano timer)';
                this.logger.info(`🗑️ ${expired ? '⏰ Automatycznie u' : 'U'}sunięto rolę ${role.name} dla ${member.user.tag} ${reason}`);
            }
        } catch (error) {
            this.logger.error(`❌ Błąd podczas usuwania roli:`, error);
        }
    }

    /**
     * Zapisuje timery do pliku
     */
    async saveTimersToFile() {
        try {
            await fs.writeFile(this.timersFilePath, JSON.stringify(this.persistentTimers, null, 2));
        } catch (error) {
            this.logger.error('❌ Błąd podczas zapisywania timerów:', error);
        }
    }

    /**
     * Dodaje timer do persystencji
     */
    async addTimerToPersistence(userId, roleId, guildId, expiresAt) {
        const timerInfo = { userId, roleId, guildId, expiresAt };
        
        // Usuń ewentualny poprzedni timer dla tego użytkownika i roli
        this.persistentTimers = this.persistentTimers.filter(
            timer => !(timer.userId === userId && timer.roleId === roleId)
        );
        
        // Dodaj nowy timer
        this.persistentTimers.push(timerInfo);
        await this.saveTimersToFile();
    }

    /**
     * Usuwa timer z persystencji
     */
    async removeTimerFromPersistence(userId, roleId) {
        this.persistentTimers = this.persistentTimers.filter(
            timer => !(timer.userId === userId && timer.roleId === roleId)
        );
        await this.saveTimersToFile();
    }

    /**
     * Obsługuje dodanie reakcji
     */
    async handleReactionAdd(reaction, user) {
        try {
            // Ignoruj boty
            if (user.bot) return;

            const emojiName = this.getEmojiIdentifier(reaction.emoji);
            
            // Sprawdź czy emoji jest skonfigurowane - loguj tylko jeśli TAK
            if (!this.reactionRoleConfig[emojiName]) {
                return; // Cichy return dla nieskonfigurowanych reakcji
            }
            
            // LOGUJ tylko dla skonfigurowanych reakcji (flaga ukrainy)
            this.logger.info(`🇺🇦 Wykryto reakcję flagi ukrainy od ${user.tag}`);

            const roleId = this.reactionRoleConfig[emojiName];
            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(roleId);

            if (!role) {
                this.logger.error(`❌ Nie można znaleźć roli o ID: ${roleId}`);
                return;
            }

            // Sprawdź czy użytkownik już ma rolę
            if (member.roles.cache.has(roleId)) {
                return; // Cichy return jeśli już ma rolę
            }

            // Dodaj rolę
            await member.roles.add(role);
            this.logger.info(`🇺🇦 Nadano rolę ukraińską dla ${user.tag} na 5 minut`);

            // Ustaw timer usunięcia roli
            await this.setRoleRemovalTimer(member, role, user);

        } catch (error) {
            this.logger.error(`❌ Błąd podczas dodawania roli za reakcję:`, error);
        }
    }

    /**
     * Obsługuje usunięcie reakcji
     */
    async handleReactionRemove(reaction, user) {
        try {
            // Ignoruj boty
            if (user.bot) return;

            const emojiName = this.getEmojiIdentifier(reaction.emoji);
            
            // Sprawdź czy emoji jest skonfigurowane - loguj tylko jeśli TAK
            if (!this.reactionRoleConfig[emojiName]) {
                return; // Cichy return dla nieskonfigurowanych reakcji
            }
            
            // LOGUJ tylko dla skonfigurowanych reakcji (flaga ukrainy)
            this.logger.info(`🇺🇦 Usunięto reakcję flagi ukrainy przez ${user.tag} - anulowanie timera`);

            const roleId = this.reactionRoleConfig[emojiName];
            const timerKey = `${user.id}-${roleId}`;

            // Anuluj timer usunięcia roli jeśli istnieje
            if (this.roleRemovalTimers.has(timerKey)) {
                clearTimeout(this.roleRemovalTimers.get(timerKey));
                this.roleRemovalTimers.delete(timerKey);
                
                // Usuń z persystencji
                await this.removeTimerFromPersistence(user.id, roleId);
                
                // Natychmiast usuń rolę
                const guild = reaction.message.guild;
                const member = await guild.members.fetch(user.id);
                const role = guild.roles.cache.get(roleId);

                if (role && member.roles.cache.has(roleId)) {
                    await member.roles.remove(role);
                    this.logger.info(`🇺🇦 Natychmiast usunięto rolę ukraińską dla ${user.tag}`);
                }
            }

        } catch (error) {
            this.logger.error(`❌ Błąd podczas usuwania roli za reakcję:`, error);
        }
    }

    /**
     * Ustawia timer automatycznego usunięcia roli
     */
    async setRoleRemovalTimer(member, role, user) {
        const timerKey = `${user.id}-${role.id}`;
        const expiresAt = Date.now() + this.roleHoldTime;
        
        // Anuluj poprzedni timer jeśli istnieje
        if (this.roleRemovalTimers.has(timerKey)) {
            clearTimeout(this.roleRemovalTimers.get(timerKey));
        }

        // Dodaj do persystencji
        await this.addTimerToPersistence(user.id, role.id, member.guild.id, expiresAt);

        // Ustaw nowy timer
        const timer = setTimeout(async () => {
            try {
                // Sprawdź czy członek nadal istnieje na serwerze
                const freshMember = await member.guild.members.fetch(user.id).catch(() => null);
                
                if (freshMember && freshMember.roles.cache.has(role.id)) {
                    await freshMember.roles.remove(role);
                    this.logger.info(`🇺🇦 ⏰ Automatycznie usunięto rolę ukraińską dla ${user.tag} po 5 minutach`);
                }
                
                // Usuń timer z mapy i persystencji
                this.roleRemovalTimers.delete(timerKey);
                await this.removeTimerFromPersistence(user.id, role.id);
                
            } catch (error) {
                this.logger.error(`❌ Błąd podczas automatycznego usuwania roli:`, error);
                this.roleRemovalTimers.delete(timerKey);
                await this.removeTimerFromPersistence(user.id, role.id);
            }
        }, this.roleHoldTime);

        this.roleRemovalTimers.set(timerKey, timer);
    }

    /**
     * Pobiera identyfikator emoji (name lub id dla custom emoji)
     */
    getEmojiIdentifier(emoji) {
        return emoji.name || emoji.id;
        // Usuń debug emoji logging
    }

    /**
     * Czyści wszystkie aktywne timery (przy wyłączaniu bota)
     */
    cleanup() {
        this.logger.info(`🧹 Czyszczenie ${this.roleRemovalTimers.size} aktywnych timerów reaction roles`);
        
        for (const timer of this.roleRemovalTimers.values()) {
            clearTimeout(timer);
        }
        
        this.roleRemovalTimers.clear();
    }

    /**
     * Zwraca statystyki aktywnych timerów
     */
    getStats() {
        return {
            activeTimers: this.roleRemovalTimers.size,
            configuredReactions: Object.keys(this.reactionRoleConfig).length
        };
    }
}

module.exports = ReactionRoleService;