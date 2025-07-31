const fs = require('fs').promises;
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Wydarzynier');

class BazarService {
    constructor(config) {
        this.config = config;
        this.bazarDataFile = './Wydarzynier/data/bazar.json';
        this.timers = new Map(); // Mapa timerów dla każdego kanału
        this.isActive = false;
        this.startHour = null;
        this.categoryId = null;
        this.channelIds = [];
        this.client = null;
    }

    /**
     * Inicjalizuje serwis
     * @param {Client} client - Klient Discord
     */
    async initialize(client) {
        this.client = client;
        await this.loadFromFile();
        
        if (this.isActive) {
            logger.info('Przywracanie timerów bazaru po restarcie...');
            await this.restoreTimers();
        }
    }

    /**
     * Odczytuje dane bazaru z pliku
     */
    async loadFromFile() {
        try {
            const data = await fs.readFile(this.bazarDataFile, 'utf8');
            const bazarData = JSON.parse(data);
            
            this.isActive = bazarData.isActive || false;
            this.startHour = bazarData.startHour || null;
            this.categoryId = bazarData.categoryId || null;
            this.channelIds = bazarData.channelIds || [];
            
            logger.info(`Wczytano dane bazaru: aktywny=${this.isActive}, godzina=${this.startHour}, kanały=${this.channelIds.length}`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.info('Plik bazaru nie istnieje, inicjalizacja z pustymi danymi');
            } else {
                logger.error('Błąd wczytywania danych bazaru:', error.message);
            }
        }
    }

    /**
     * Zapisuje dane bazaru do pliku
     */
    async saveToFile() {
        try {
            const bazarData = {
                isActive: this.isActive,
                startHour: this.startHour,
                categoryId: this.categoryId,
                channelIds: this.channelIds
            };

            await fs.writeFile(this.bazarDataFile, JSON.stringify(bazarData, null, 2));
            logger.info('Zapisano dane bazaru do pliku');
        } catch (error) {
            logger.error('Błąd zapisu danych bazaru:', error.message);
        }
    }

    /**
     * Tworzy kategorię i kanały bazaru
     * @param {Guild} guild - Serwer Discord
     * @param {number} startHour - Godzina startu (17 lub 18)
     */
    async createBazar(guild, startHour) {
        try {
            // Sprawdź czy bazar już istnieje
            if (this.isActive) {
                return { success: false, message: 'Bazar już istnieje! Użyj /bazar-off aby go usunąć.' };
            }

            logger.info(`Tworzenie bazaru z godziną startu: ${startHour}:00`);

            // Utwórz kategorię
            const category = await guild.channels.create({
                name: 'Bazar',
                type: ChannelType.GuildCategory,
                reason: 'Utworzenie kategorii bazaru'
            });

            this.categoryId = category.id;

            // Nazwy kanałów
            const channelNames = [
                '250-szare-zielone',
                '750-niebieskie-fioletowe', 
                '2500-żółte',
                '7500-czerwone'
            ];

            // Utwórz kanały tekstowe
            const channelIds = [];
            for (const channelName of channelNames) {
                const channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                    reason: `Utworzenie kanału bazaru: ${channelName}`
                });
                channelIds.push(channel.id);
                logger.info(`Utworzono kanał bazaru: ${channelName} (${channel.id})`);
            }

            this.channelIds = channelIds;
            this.startHour = startHour;
            this.isActive = true;

            // Zapisz dane
            await this.saveToFile();

            // Uruchom timery
            await this.startTimers(guild);

            return { 
                success: true, 
                message: `Bazar utworzony pomyślnie! Kanały będą resetowane co 2 godziny zaczynając od ${startHour}:00.`,
                categoryId: this.categoryId,
                channelIds: this.channelIds
            };

        } catch (error) {
            logger.error('Błąd tworzenia bazaru:', error.message);
            return { success: false, message: `Błąd tworzenia bazaru: ${error.message}` };
        }
    }

    /**
     * Usuwa kategorię i kanały bazaru
     * @param {Guild} guild - Serwer Discord
     */
    async removeBazar(guild) {
        try {
            if (!this.isActive) {
                return { success: false, message: 'Bazar nie istnieje!' };
            }

            logger.info('Usuwanie bazaru...');

            // Zatrzymaj wszystkie timery
            this.clearAllTimers();

            // Usuń kanały
            let deletedChannels = 0;
            for (const channelId of this.channelIds) {
                try {
                    const channel = guild.channels.cache.get(channelId);
                    if (channel) {
                        await channel.delete('Usunięcie kanału bazaru');
                        deletedChannels++;
                        logger.info(`Usunięto kanał: ${channel.name}`);
                    }
                } catch (error) {
                    logger.warn(`Nie udało się usunąć kanału ${channelId}:`, error.message);
                }
            }

            // Usuń kategorię
            if (this.categoryId) {
                try {
                    const category = guild.channels.cache.get(this.categoryId);
                    if (category) {
                        await category.delete('Usunięcie kategorii bazaru');
                        logger.info('Usunięto kategorię Bazar');
                    }
                } catch (error) {
                    logger.warn('Nie udało się usunąć kategorii:', error.message);
                }
            }

            // Resetuj dane
            this.isActive = false;
            this.startHour = null;
            this.categoryId = null;
            this.channelIds = [];

            // Zapisz puste dane
            await this.saveToFile();

            return { 
                success: true, 
                message: `Bazar usunięty pomyślnie! Usunięto ${deletedChannels} kanałów i kategorię.`
            };

        } catch (error) {
            logger.error('Błąd usuwania bazaru:', error.message);
            return { success: false, message: `Błąd usuwania bazaru: ${error.message}` };
        }
    }

    /**
     * Uruchamia timery dla wszystkich kanałów bazaru
     * @param {Guild} guild - Serwer Discord
     */
    async startTimers(guild) {
        if (!this.isActive || !this.startHour) {
            logger.warn('Nie można uruchomić timerów - bazar nieaktywny');
            return;
        }

        logger.info(`Uruchamianie timerów bazaru (start: ${this.startHour}:00)`);

        for (const channelId of this.channelIds) {
            await this.scheduleChannelTimers(guild, channelId);
        }
    }

    /**
     * Planuje timery dla pojedynczego kanału
     * @param {Guild} guild - Serwer Discord
     * @param {string} channelId - ID kanału
     */
    async scheduleChannelTimers(guild, channelId) {
        const channel = guild.channels.cache.get(channelId);
        if (!channel) {
            logger.warn(`Kanał ${channelId} nie został znaleziony`);
            return;
        }

        // Oblicz następny reset (co 2 godziny od startHour)
        const now = new Date();
        const nextReset = this.getNextResetTime(now);
        const timeToReset = nextReset.getTime() - now.getTime();

        logger.info(`Kanał ${channel.name}: następny reset za ${Math.round(timeToReset / 1000 / 60)} minut`);

        // Timer głównego resetu
        const resetTimer = setTimeout(async () => {
            await this.performReset(guild, channelId);
            // Ustaw timer na następny reset (2 godziny)
            this.scheduleNextReset(guild, channelId);
        }, timeToReset);

        // Timer przypomnienia 1h przed resetem
        const oneHourWarning = timeToReset - (60 * 60 * 1000); // 1 godzina przed
        if (oneHourWarning > 0) {
            const oneHourTimer = setTimeout(async () => {
                await this.sendWarning(guild, channelId, '## Pozostała godzina do resetu bazaru!');
            }, oneHourWarning);
            
            this.setTimer(channelId, 'oneHour', oneHourTimer);
        }

        // Timer przypomnienia 15min przed resetem  
        const fifteenMinWarning = timeToReset - (15 * 60 * 1000); // 15 minut przed
        if (fifteenMinWarning > 0) {
            const fifteenMinTimer = setTimeout(async () => {
                await this.sendWarning(guild, channelId, '## Za 15 minut reset bazaru!');
            }, fifteenMinWarning);
            
            this.setTimer(channelId, 'fifteenMin', fifteenMinTimer);
        }

        this.setTimer(channelId, 'reset', resetTimer);
    }

    /**
     * Planuje następny reset (2 godziny później)
     * @param {Guild} guild - Serwer Discord
     * @param {string} channelId - ID kanału
     */
    scheduleNextReset(guild, channelId) {
        const twoHours = 2 * 60 * 60 * 1000; // 2 godziny w ms

        // Timer głównego resetu (2 godziny)
        const resetTimer = setTimeout(async () => {
            await this.performReset(guild, channelId);
            this.scheduleNextReset(guild, channelId); // Rekurencyjnie planuj następny
        }, twoHours);

        // Timer przypomnienia 1h przed (1 godzina)
        const oneHourTimer = setTimeout(async () => {
            await this.sendWarning(guild, channelId, '## Pozostała godzina do resetu bazaru!');
        }, 60 * 60 * 1000);

        // Timer przypomnienia 15min przed (1h 45min)
        const fifteenMinTimer = setTimeout(async () => {
            await this.sendWarning(guild, channelId, '## Za 15 minut reset bazaru!');
        }, 105 * 60 * 1000); // 1h 45min

        // Zapisz timery
        this.setTimer(channelId, 'reset', resetTimer);
        this.setTimer(channelId, 'oneHour', oneHourTimer);
        this.setTimer(channelId, 'fifteenMin', fifteenMinTimer);
    }

    /**
     * Oblicza czas następnego resetu bazaru
     * @param {Date} now - Obecny czas
     * @returns {Date} - Czas następnego resetu
     */
    getNextResetTime(now) {
        const nextReset = new Date(now);
        nextReset.setMinutes(0, 0, 0); // Ustaw na pełną godzinę

        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();

        // Stały cykl co 2 godziny przez całą dobę
        // Parametr startHour określa przesunięcie w cyklu
        // Dla startHour=18: resety o 0,2,4,6,8,10,12,14,16,18,20,22
        // Dla startHour=17: resety o 1,3,5,7,9,11,13,15,17,19,21,23
        
        let targetHour = currentHour;
        
        // Sprawdź czy obecna godzina jest godziną resetu
        const isResetHour = (targetHour % 2) === (this.startHour % 2);
        
        if (isResetHour && currentMinute === 0) {
            // Jest dokładnie godzina resetu
            targetHour = currentHour;
        } else {
            // Znajdź następną godzinę resetu
            do {
                targetHour++;
                if (targetHour >= 24) {
                    targetHour = 0;
                    nextReset.setDate(nextReset.getDate() + 1);
                }
            } while ((targetHour % 2) !== (this.startHour % 2));
        }

        nextReset.setHours(targetHour);
        return nextReset;
    }

    /**
     * Wykonuje reset kanału - usuwa wiadomości i wysyła nową
     * @param {Guild} guild - Serwer Discord
     * @param {string} channelId - ID kanału
     */
    async performReset(guild, channelId) {
        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                logger.warn(`Kanał ${channelId} nie został znaleziony podczas resetu`);
                return;
            }

            logger.info(`Wykonywanie resetu kanału: ${channel.name}`);

            // Usuń wszystkie wiadomości z kanału
            await this.clearChannelMessages(channel);

            // Wyślij wiadomość o resecie
            const resetMessage = await channel.send('# Bazar został zresetowany! Kolejny reset za 2h.');
            
            logger.info(`Reset kanału ${channel.name} zakończony pomyślnie`);

        } catch (error) {
            logger.error(`Błąd podczas resetu kanału ${channelId}:`, error.message);
        }
    }

    /**
     * Usuwa wszystkie wiadomości z kanału
     * @param {TextChannel} channel - Kanał tekstowy
     */
    async clearChannelMessages(channel) {
        try {
            // Pobierz wszystkie wiadomości (w partiach po 100)
            let deleted = 0;
            let lastId;

            do {
                const options = { limit: 100 };
                if (lastId) {
                    options.before = lastId;
                }

                const messages = await channel.messages.fetch(options);
                if (messages.size === 0) break;

                lastId = messages.last().id;

                // Usuń wiadomości partiami
                const messagesToDelete = messages.filter(msg => {
                    const age = Date.now() - msg.createdTimestamp;
                    return age < 14 * 24 * 60 * 60 * 1000; // Młodsze niż 14 dni
                });

                if (messagesToDelete.size > 0) {
                    if (messagesToDelete.size === 1) {
                        await messagesToDelete.first().delete();
                        deleted += 1;
                    } else {
                        await channel.bulkDelete(messagesToDelete);
                        deleted += messagesToDelete.size;
                    }
                }

                // Usuń stare wiadomości pojedynczo (starsze niż 14 dni)
                const oldMessages = messages.filter(msg => {
                    const age = Date.now() - msg.createdTimestamp;
                    return age >= 14 * 24 * 60 * 60 * 1000;
                });

                for (const [, message] of oldMessages) {
                    try {
                        await message.delete();
                        deleted += 1;
                        await new Promise(resolve => setTimeout(resolve, 100)); // Opóźnienie
                    } catch (error) {
                        logger.warn(`Nie udało się usunąć starej wiadomości: ${error.message}`);
                    }
                }

            } while (true);

            logger.info(`Usunięto ${deleted} wiadomości z kanału ${channel.name}`);

        } catch (error) {
            logger.error(`Błąd czyszczenia kanału ${channel.name}:`, error.message);
        }
    }

    /**
     * Wysyła ostrzeżenie do kanału
     * @param {Guild} guild - Serwer Discord
     * @param {string} channelId - ID kanału
     * @param {string} message - Treść ostrzeżenia
     */
    async sendWarning(guild, channelId, message) {
        try {
            const channel = guild.channels.cache.get(channelId);
            if (!channel) {
                logger.warn(`Kanał ${channelId} nie został znaleziony dla ostrzeżenia`);
                return;
            }

            await channel.send(message);
            logger.info(`Wysłano ostrzeżenie do kanału ${channel.name}: ${message}`);

        } catch (error) {
            logger.error(`Błąd wysyłania ostrzeżenia do kanału ${channelId}:`, error.message);
        }
    }

    /**
     * Przypina wiadomość do kanału bazaru
     * @param {TextChannel} channel - Kanał
     * @param {Message} message - Wiadomość do przypięcia
     */
    async pinMessage(channel, message) {
        try {
            if (!this.channelIds.includes(channel.id)) {
                return false; // Nie jest kanałem bazaru
            }

            await message.pin();
            logger.info(`Przypięto wiadomość w kanale bazaru: ${channel.name}`);
            return true;

        } catch (error) {
            logger.error(`Błąd przypinania wiadomości w kanale ${channel.name}:`, error.message);
            return false;
        }
    }

    /**
     * Przywraca timery po restarcie bota
     */
    async restoreTimers() {
        if (!this.client || !this.isActive) {
            return;
        }

        try {
            const guild = this.client.guilds.cache.first();
            if (!guild) {
                logger.warn('Nie znaleziono serwera do przywrócenia timerów bazaru');
                return;
            }

            // Sprawdź czy kanały nadal istnieją
            const existingChannels = [];
            for (const channelId of this.channelIds) {
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    existingChannels.push(channelId);
                } else {
                    logger.warn(`Kanał bazaru ${channelId} nie istnieje, pomijam`);
                }
            }

            this.channelIds = existingChannels;

            if (this.channelIds.length === 0) {
                logger.warn('Brak istniejących kanałów bazaru, deaktywuję');
                this.isActive = false;
                await this.saveToFile();
                return;
            }

            // Uruchom timery dla istniejących kanałów
            await this.startTimers(guild);
            logger.info(`Przywrócono timery bazaru dla ${this.channelIds.length} kanałów`);

        } catch (error) {
            logger.error('Błąd przywracania timerów bazaru:', error.message);
        }
    }

    /**
     * Zapisuje timer dla kanału
     * @param {string} channelId - ID kanału
     * @param {string} type - Typ timera (reset, oneHour, fifteenMin)
     * @param {NodeJS.Timeout} timer - Timer
     */
    setTimer(channelId, type, timer) {
        if (!this.timers.has(channelId)) {
            this.timers.set(channelId, {});
        }
        this.timers.get(channelId)[type] = timer;
    }

    /**
     * Czyści wszystkie timery
     */
    clearAllTimers() {
        for (const [channelId, channelTimers] of this.timers) {
            for (const [type, timer] of Object.entries(channelTimers)) {
                if (timer) {
                    clearTimeout(timer);
                    logger.info(`Wyczyszczono timer ${type} dla kanału ${channelId}`);
                }
            }
        }
        this.timers.clear();
    }

    /**
     * Sprawdza czy kanał należy do bazaru
     * @param {string} channelId - ID kanału
     * @returns {boolean}
     */
    isBazarChannel(channelId) {
        return this.isActive && this.channelIds.includes(channelId);
    }

    /**
     * Pobiera status bazaru
     * @returns {Object}
     */
    getStatus() {
        return {
            isActive: this.isActive,
            startHour: this.startHour,
            categoryId: this.categoryId,
            channelIds: this.channelIds,
            nextReset: this.isActive ? this.getNextResetTime(new Date()) : null
        };
    }
}

module.exports = BazarService;