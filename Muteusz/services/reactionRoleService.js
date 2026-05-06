const { safeParse } = require('../../utils/safeJSON');
const { createBotLogger } = require('../../utils/consoleLogger');
const NicknameManager = require('../../utils/nicknameManagerService');
const fs = require('fs').promises;
const path = require('path');

class ReactionRoleService {
    constructor(config, nicknameManager) {
        this.config = config;
        this.logger = createBotLogger('Muteusz');
        this.nicknameManager = nicknameManager;
        
        // Mapa aktywnych timerów usuwania ról
        this.roleRemovalTimers = new Map();
        
        // Przechowuje dane o timerach dla persystencji
        this.persistentTimers = [];
        
        // Lista nicków flag do walidacji
        this.flagNicknames = [
            "Slava Ukrainu!",
            "POLSKA GUROM!",
            "Shalom!",
            "American Dream",
            "Hände hoch!",
            "Cyka blyat!"
        ];
        
        // Konfiguracja reakcji -> rola
        this.reactionRoleConfig = {
            'flag_ua': '1409530749937254470', // ID roli dla flagi ukrainy (:flag_ua:)
            '🇺🇦': '1409530749937254470', // ID roli dla flagi ukrainy (Unicode)
            'ua': '1409530749937254470', // ID roli dla flagi ukrainy (możliwe skrócenie)
            'flag_pl': '1409793972980678656', // ID roli dla flagi polski (:flag_pl:)
            '🇵🇱': '1409793972980678656', // ID roli dla flagi polski (Unicode)
            'pl': '1409793972980678656', // ID roli dla flagi polski (możliwe skrócenie)
            'flag_il': '1409796409707728967', // ID roli dla flagi izraela (:flag_il:)
            '🇮🇱': '1409796409707728967', // ID roli dla flagi izraela (Unicode)
            'il': '1409796409707728967', // ID roli dla flagi izraela (możliwe skrócenie)
            'flag_us': '1409798492217544805', // ID roli dla flagi USA (:flag_us:)
            '🇺🇸': '1409798492217544805', // ID roli dla flagi USA (Unicode)
            'us': '1409798492217544805', // ID roli dla flagi USA (możliwe skrócenie)
            'flag_de': '1409799488385581077', // ID roli dla flagi niemiec (:flag_de:)
            '🇩🇪': '1409799488385581077', // ID roli dla flagi niemiec (Unicode)
            'de': '1409799488385581077', // ID roli dla flagi niemiec (możliwe skrócenie)
            'flag_ru': '1409808370122227796', // ID roli dla flagi rosji (:flag_ru:)
            '🇷🇺': '1409808370122227796', // ID roli dla flagi rosji (Unicode)
            'ru': '1409808370122227796' // ID roli dla flagi rosji (możliwe skrócenie)
        };
        
        // Konfiguracja reaction roles na konkretnych wiadomościach
        // Format: messageId -> [{ emoji, roleId }]
        this.messageReactionRoles = {
            '1470745800211562576': [
                { emoji: '✅', roleId: '1470702781638901834', channelId: '1278621023205458015' }
            ]
        };

        // Czas trzymania roli w milisekundach (5 minut)
        this.roleHoldTime = 5 * 60 * 1000;
        
        // Ścieżka do pliku z aktywnymi timerami
        this.timersFilePath = path.join(__dirname, '../data/reaction_role_timers.json');
        // USUNIĘTO: Stary system nicków zastąpiony centralnym NicknameManager
        // Zachowano dla kompatybilności wstecznej - stare pliki będą ignorowane
        
        // Klien Discord (zostanie ustawiony w initialize)
        this.client = null;
    }

    /**
     * Inicjalizuje serwis i przywraca timery z pliku
     */
    async initialize(client) {
        this.client = client;
        await this.restoreTimersFromFile();
        // USUNIĘTO: restoreNicknamesFromFile() - zastąpione centralnym NicknameManager

        // Synchronizuj wygasłe flagi (efekty FLAG bez timerów)
        await this.syncExpiredFlags();
    }

    /**
     * Ładuje i przywraca timery z pliku
     */
    async restoreTimersFromFile() {
        try {
            const data = await fs.readFile(this.timersFilePath, 'utf8');
            const timersData = safeParse(data, []);

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
                
                // Przywróć oryginalny nick tylko jeśli to jedna z ról flag
                const isFlagRole = Object.values(this.reactionRoleConfig).includes(roleId);
                
                if (isFlagRole) {
                    await this.restoreOriginalNickname(member);
                }
                
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

    // USUNIĘTO: Stare metody zarządzania nickami
    // restoreNicknamesFromFile() i saveNicknamesToFile() zastąpione centralnym NicknameManager

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
     * Zmienia nick użytkownika na ukraiński przy użyciu centralnego systemu
     */
    async setUkrainianNickname(member) {
        try {
            const userId = member.user.id;
            const ukrainianNick = "Slava Ukrainu!";

            // Walidacja przez centralny system
            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na ukraiński: ${validation.reason}`);
                return false;
            }

            // Zapisz oryginalny nick w centralnym systemie (flagi nie wygasają automatycznie)
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            // Zmień nick na ukraiński
            await member.setNickname(ukrainianNick);
            this.logger.info(`🇺🇦 Zmieniono nick ${member.user.tag} na "${ukrainianNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na ukraiński:`, error);
            return false;
        }
    }

    /**
     * Zmienia nick użytkownika na polski przy użyciu centralnego systemu
     */
    async setPolishNickname(member) {
        try {
            const userId = member.user.id;
            const polishNick = "POLSKA GUROM!";

            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na polski: ${validation.reason}`);
                return false;
            }

            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            await member.setNickname(polishNick);
            this.logger.info(`🇵🇱 Zmieniono nick ${member.user.tag} na "${polishNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na polski:`, error);
            return false;
        }
    }

    /**
     * Zmienia nick użytkownika na izraelski i zapisuje oryginalny
     */
    async setIsraeliNickname(member) {
        try {
            const userId = member.user.id;
            const israeliNick = "עם ישראל חי!";

            // Walidacja z centralnym systemem
            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na izraelski: ${validation.reason}`);
                return false;
            }

            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            // Zmień nick na izraelski
            await member.setNickname(israeliNick);
            this.logger.info(`🇮🇱 Zmieniono nick ${member.user.tag} na "${israeliNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na izraelski:`, error);
            return false;
        }
    }

    /**
     * Zmienia nick użytkownika na amerykański i zapisuje oryginalny
     */
    async setAmericanNickname(member) {
        try {
            const userId = member.user.id;
            const americanNick = "American Dream";

            // Walidacja z centralnym systemem
            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na amerykański: ${validation.reason}`);
                return false;
            }

            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            // Zmień nick na amerykański
            await member.setNickname(americanNick);
            this.logger.info(`🇺🇸 Zmieniono nick ${member.user.tag} na "${americanNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na amerykański:`, error);
            return false;
        }
    }

    /**
     * Zmienia nick użytkownika na niemiecki i zapisuje oryginalny
     */
    async setGermanNickname(member) {
        try {
            const userId = member.user.id;
            const germanNick = "Hände hoch!";

            // Walidacja z centralnym systemem
            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na niemiecki: ${validation.reason}`);
                return false;
            }

            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            // Zmień nick na niemiecki
            await member.setNickname(germanNick);
            this.logger.info(`🇩🇪 Zmieniono nick ${member.user.tag} na "${germanNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na niemiecki:`, error);
            return false;
        }
    }

    /**
     * Zmienia nick użytkownika na rosyjski i zapisuje oryginalny
     */
    async setRussianNickname(member) {
        try {
            const userId = member.user.id;
            const russianNick = "Cyka blyat!";

            // Walidacja z centralnym systemem
            const validation = await this.nicknameManager.validateEffectApplication(
                member,
                NicknameManager.EFFECTS.FLAG
            );

            if (!validation.canApply) {
                this.logger.warn(`❌ Nie można zmienić nicku na rosyjski: ${validation.reason}`);
                return false;
            }

            // Zapisz oryginalny nick w centralnym systemie
            await this.nicknameManager.saveOriginalNickname(
                userId,
                NicknameManager.EFFECTS.FLAG,
                member,
                Infinity
            );

            // Zmień nick na rosyjski
            await member.setNickname(russianNick);
            this.logger.info(`🇷🇺 Zmieniono nick ${member.user.tag} na "${russianNick}"`);
            return true;

        } catch (error) {
            this.logger.error(`❌ Błąd podczas zmiany nicku na rosyjski:`, error);
            return false;
        }
    }

    /**
     * Sprawdza czy podany nick to nick flagi
     */
    isFlagNickname(nickname) {
        return this.flagNicknames.includes(nickname);
    }

    /**
     * Przywraca oryginalny nick użytkownika przy użyciu centralnego systemu
     */
    async restoreOriginalNickname(member) {
        try {
            const userId = member.user.id;
            
            // Użyj centralnego systemu do przywrócenia oryginalnego nicku
            const restored = await this.nicknameManager.restoreOriginalNickname(userId, member.guild);
            if (restored) {
                this.logger.info(`✅ Przywrócono oryginalny nick dla ${member.user.tag}`);
                return true;
            } else {
                this.logger.warn(`⚠️ Brak zapisanego oryginalnego nicku dla ${member.user.tag}`);
                return false;
            }

        } catch (error) {
            this.logger.error(`❌ Błąd podczas przywracania nicku:`, error);
            return false;
        }
    }

    /**
     * Obsługuje dodanie reakcji
     */
    async handleReactionAdd(reaction, user) {
        try {
            // Ignoruj boty
            if (user.bot) return;

            // Sprawdź reaction roles na konkretnych wiadomościach
            const messageRoleHandled = await this.handleMessageReactionAdd(reaction, user);
            if (messageRoleHandled) return;

            const emojiName = this.getEmojiIdentifier(reaction.emoji);
            
            // Sprawdź czy emoji jest skonfigurowane - loguj tylko jeśli TAK
            if (!this.reactionRoleConfig[emojiName]) {
                return; // Cichy return dla nieskonfigurowanych reakcji
            }
            
            // LOGUJ tylko dla skonfigurowanych reakcji (flagi)
            const isUkrainian = ['flag_ua', '🇺🇦', 'ua'].includes(emojiName);
            const isPolish = ['flag_pl', '🇵🇱', 'pl'].includes(emojiName);
            const isIsraeli = ['flag_il', '🇮🇱', 'il'].includes(emojiName);
            const isAmerican = ['flag_us', '🇺🇸', 'us'].includes(emojiName);
            const isGerman = ['flag_de', '🇩🇪', 'de'].includes(emojiName);
            const isRussian = ['flag_ru', '🇷🇺', 'ru'].includes(emojiName);
            
            if (isUkrainian) {
                this.logger.info(`🇺🇦 Wykryto reakcję flagi ukrainy od ${user.tag}`);
            } else if (isPolish) {
                this.logger.info(`🇵🇱 Wykryto reakcję flagi polski od ${user.tag}`);
            } else if (isIsraeli) {
                this.logger.info(`🇮🇱 Wykryto reakcję flagi izraela od ${user.tag}`);
            } else if (isAmerican) {
                this.logger.info(`🇺🇸 Wykryto reakcję flagi USA od ${user.tag}`);
            } else if (isGerman) {
                this.logger.info(`🇩🇪 Wykryto reakcję flagi niemiec od ${user.tag}`);
            } else if (isRussian) {
                this.logger.info(`🇷🇺 Wykryto reakcję flagi rosji od ${user.tag}`);
            }

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

            // Sprawdź czy użytkownik już ma jakąkolwiek rolę flagi
            const userRoles = member.roles.cache.map(role => role.id);
            const flagRoleIds = Object.values(this.reactionRoleConfig);
            const hasAnyFlagRole = userRoles.some(roleId => flagRoleIds.includes(roleId));
            
            if (hasAnyFlagRole) {
                this.logger.info(`⚠️ ${user.tag} już ma aktywną rolę flagi - ignoruję nową reakcję`);
                return; // Cichy return jeśli już ma inną flagę
            }

            // Dodaj rolę
            await member.roles.add(role);
            
            if (isUkrainian) {
                this.logger.info(`🇺🇦 Nadano rolę ukraińską dla ${user.tag} na 5 minut`);
                // Zmień nick na ukraiński
                await this.setUkrainianNickname(member);
            } else if (isPolish) {
                this.logger.info(`🇵🇱 Nadano rolę polską dla ${user.tag} na 5 minut`);
                // Zmień nick na polski
                await this.setPolishNickname(member);
            } else if (isIsraeli) {
                this.logger.info(`🇮🇱 Nadano rolę izraelską dla ${user.tag} na 5 minut`);
                // Zmień nick na izraelski
                await this.setIsraeliNickname(member);
            } else if (isAmerican) {
                this.logger.info(`🇺🇸 Nadano rolę amerykańską dla ${user.tag} na 5 minut`);
                // Zmień nick na amerykański
                await this.setAmericanNickname(member);
            } else if (isGerman) {
                this.logger.info(`🇩🇪 Nadano rolę niemiecką dla ${user.tag} na 5 minut`);
                // Zmień nick na niemiecki
                await this.setGermanNickname(member);
            } else if (isRussian) {
                this.logger.info(`🇷🇺 Nadano rolę rosyjską dla ${user.tag} na 5 minut`);
                // Zmień nick na rosyjski
                await this.setRussianNickname(member);
            }

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

            // Sprawdź reaction roles na konkretnych wiadomościach
            const messageRoleHandled = await this.handleMessageReactionRemove(reaction, user);
            if (messageRoleHandled) return;

            const emojiName = this.getEmojiIdentifier(reaction.emoji);
            
            // Sprawdź czy emoji jest skonfigurowane - loguj tylko jeśli TAK
            if (!this.reactionRoleConfig[emojiName]) {
                return; // Cichy return dla nieskonfigurowanych reakcji
            }
            
            // LOGUJ tylko dla skonfigurowanych reakcji (flagi)
            const isUkrainian = ['flag_ua', '🇺🇦', 'ua'].includes(emojiName);
            const isPolish = ['flag_pl', '🇵🇱', 'pl'].includes(emojiName);
            const isIsraeli = ['flag_il', '🇮🇱', 'il'].includes(emojiName);
            const isAmerican = ['flag_us', '🇺🇸', 'us'].includes(emojiName);
            const isGerman = ['flag_de', '🇩🇪', 'de'].includes(emojiName);
            const isRussian = ['flag_ru', '🇷🇺', 'ru'].includes(emojiName);
            
            if (isUkrainian) {
                this.logger.info(`🇺🇦 Usunięto reakcję flagi ukrainy przez ${user.tag} - anulowanie timera`);
            } else if (isPolish) {
                this.logger.info(`🇵🇱 Usunięto reakcję flagi polski przez ${user.tag} - anulowanie timera`);
            } else if (isIsraeli) {
                this.logger.info(`🇮🇱 Usunięto reakcję flagi izraela przez ${user.tag} - anulowanie timera`);
            } else if (isAmerican) {
                this.logger.info(`🇺🇸 Usunięto reakcję flagi USA przez ${user.tag} - anulowanie timera`);
            } else if (isGerman) {
                this.logger.info(`🇩🇪 Usunięto reakcję flagi niemiec przez ${user.tag} - anulowanie timera`);
            } else if (isRussian) {
                this.logger.info(`🇷🇺 Usunięto reakcję flagi rosji przez ${user.tag} - anulowanie timera`);
            }

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
                    // Przywróć oryginalny nick
                    await this.restoreOriginalNickname(member);
                    
                    if (isUkrainian) {
                        this.logger.info(`🇺🇦 Natychmiast usunięto rolę ukraińską dla ${user.tag}`);
                    } else if (isPolish) {
                        this.logger.info(`🇵🇱 Natychmiast usunięto rolę polską dla ${user.tag}`);
                    } else if (isIsraeli) {
                        this.logger.info(`🇮🇱 Natychmiast usunięto rolę izraelską dla ${user.tag}`);
                    } else if (isAmerican) {
                        this.logger.info(`🇺🇸 Natychmiast usunięto rolę amerykańską dla ${user.tag}`);
                    } else if (isGerman) {
                        this.logger.info(`🇩🇪 Natychmiast usunięto rolę niemiecką dla ${user.tag}`);
                    } else if (isRussian) {
                        this.logger.info(`🇷🇺 Natychmiast usunięto rolę rosyjską dla ${user.tag}`);
                    }
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

        // Określ typ flagi na podstawie roleId
        const roleId = role.id;
        let flagType = '';
        if (roleId === '1409530749937254470') flagType = '🇺🇦';
        else if (roleId === '1409793972980678656') flagType = '🇵🇱';
        else if (roleId === '1409796409707728967') flagType = '🇮🇱';
        else if (roleId === '1409798492217544805') flagType = '🇺🇸';
        else if (roleId === '1409799488385581077') flagType = '🇩🇪';
        else if (roleId === '1409808370122227796') flagType = '🇷🇺';

        // Ustaw nowy timer
        const timer = setTimeout(async () => {
            try {
                // Sprawdź czy członek nadal istnieje na serwerze
                const freshMember = await member.guild.members.fetch(user.id).catch(() => null);
                
                if (freshMember && freshMember.roles.cache.has(role.id)) {
                    await freshMember.roles.remove(role);
                    
                    // Przywróć oryginalny nick
                    const isFlagRole = Object.values(this.reactionRoleConfig).includes(roleId);
                    if (isFlagRole) {
                        await this.restoreOriginalNickname(freshMember);
                    }
                    
                    // Logowanie z odpowiednią flagą
                    if (roleId === '1409530749937254470') {
                        this.logger.info(`🇺🇦 ⏰ Automatycznie usunięto rolę ukraińską dla ${user.tag} po 5 minutach`);
                    } else if (roleId === '1409793972980678656') {
                        this.logger.info(`🇵🇱 ⏰ Automatycznie usunięto rolę polską dla ${user.tag} po 5 minutach`);
                    } else if (roleId === '1409796409707728967') {
                        this.logger.info(`🇮🇱 ⏰ Automatycznie usunięto rolę izraelską dla ${user.tag} po 5 minutach`);
                    } else if (roleId === '1409798492217544805') {
                        this.logger.info(`🇺🇸 ⏰ Automatycznie usunięto rolę USA dla ${user.tag} po 5 minutach`);
                    } else if (roleId === '1409799488385581077') {
                        this.logger.info(`🇩🇪 ⏰ Automatycznie usunięto rolę niemiecką dla ${user.tag} po 5 minutach`);
                    } else if (roleId === '1409808370122227796') {
                        this.logger.info(`🇷🇺 ⏰ Automatycznie usunięto rolę rosyjską dla ${user.tag} po 5 minutach`);
                    }
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
        
        // USUNIĘTO: Zapis nicków przy cleanup - centralny system obsługuje to automatycznie
    }

    /**
     * Synchronizuje wygasłe flagi - przywraca nicki dla efektów FLAG bez timerów
     * Wywoływane przy starcie bota, po przywróceniu timerów z pliku
     */
    async syncExpiredFlags() {
        try {
            if (!this.client) {
                this.logger.error('❌ Klient Discord nie jest dostępny podczas synchronizacji flag');
                return;
            }

            // Pobierz wszystkie aktywne efekty z nicknameManager
            const stats = this.nicknameManager.getStats();
            if (stats.flags === 0) {
                this.logger.info('✅ Brak aktywnych efektów FLAG do synchronizacji');
                return;
            }

            this.logger.info(`🔍 Sprawdzam ${stats.flags} aktywnych efektów FLAG...`);

            let restored = 0;
            let errors = 0;

            // Sprawdź każdy aktywny efekt FLAG
            for (const [userId, effectData] of this.nicknameManager.activeEffects.entries()) {
                if (effectData.effectType !== NicknameManager.EFFECTS.FLAG) {
                    continue; // Pomijamy efekty niebędące flagami
                }

                // Sprawdź czy istnieje aktywny timer dla tego użytkownika
                const userHasTimer = this.persistentTimers.some(timer => timer.userId === userId);

                if (!userHasTimer) {
                    // Brak timera - flaga wygasła podczas offline bota
                    try {
                        const guild = await this.client.guilds.fetch(effectData.guildId);
                        if (!guild) {
                            this.logger.warn(`⚠️ Nie znaleziono guild ${effectData.guildId} dla użytkownika ${userId}`);
                            errors++;
                            continue;
                        }

                        const member = await guild.members.fetch(userId);
                        if (!member) {
                            this.logger.warn(`⚠️ Nie znaleziono członka ${userId} w guild ${effectData.guildId}`);
                            errors++;
                            continue;
                        }

                        // Przywróć oryginalny nick
                        await this.restoreOriginalNickname(member);
                        restored++;

                        this.logger.info(`🔄 Przywrócono nick dla ${member.user.tag} (wygasła flaga bez timera)`);

                    } catch (error) {
                        this.logger.error(`❌ Błąd synchronizacji flagi dla ${userId}:`, error.message);
                        errors++;
                    }
                }
            }

            if (restored > 0) {
                this.logger.info(`✅ Synchronizacja flag: przywrócono ${restored} nicków, błędów: ${errors}`);
            } else if (stats.flags > 0) {
                this.logger.info('✅ Wszystkie flagi mają aktywne timery - brak synchronizacji');
            }

        } catch (error) {
            this.logger.error('❌ Błąd podczas synchronizacji flag:', error);
        }
    }

    /**
     * Obsługuje dodanie reakcji na konkretnej wiadomości (reaction roles)
     * @returns {boolean} true jeśli reakcja została obsłużona
     */
    async handleMessageReactionAdd(reaction, user) {
        const messageId = reaction.message.id;
        const config = this.messageReactionRoles[messageId];
        if (!config) return false;

        const emojiName = this.getEmojiIdentifier(reaction.emoji);

        for (const entry of config) {
            if (emojiName !== entry.emoji) continue;
            if (entry.channelId && reaction.message.channelId !== entry.channelId) continue;

            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(entry.roleId);

            if (!role) {
                this.logger.error(`❌ Reaction role: nie znaleziono roli ${entry.roleId}`);
                return true;
            }

            if (member.roles.cache.has(entry.roleId)) return true;

            await member.roles.add(role);
            this.logger.info(`✅ Reaction role: nadano rolę "${role.name}" dla ${user.tag} (wiadomość ${messageId})`);
            return true;
        }

        return false;
    }

    /**
     * Obsługuje usunięcie reakcji na konkretnej wiadomości (reaction roles)
     * @returns {boolean} true jeśli reakcja została obsłużona
     */
    async handleMessageReactionRemove(reaction, user) {
        const messageId = reaction.message.id;
        const config = this.messageReactionRoles[messageId];
        if (!config) return false;

        const emojiName = this.getEmojiIdentifier(reaction.emoji);

        for (const entry of config) {
            if (emojiName !== entry.emoji) continue;
            if (entry.channelId && reaction.message.channelId !== entry.channelId) continue;

            const guild = reaction.message.guild;
            const member = await guild.members.fetch(user.id);
            const role = guild.roles.cache.get(entry.roleId);

            if (!role) {
                this.logger.error(`❌ Reaction role: nie znaleziono roli ${entry.roleId}`);
                return true;
            }

            if (!member.roles.cache.has(entry.roleId)) return true;

            await member.roles.remove(role);
            this.logger.info(`❌ Reaction role: usunięto rolę "${role.name}" dla ${user.tag} (wiadomość ${messageId})`);
            return true;
        }

        return false;
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