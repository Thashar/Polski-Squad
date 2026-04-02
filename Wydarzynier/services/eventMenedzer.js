const fs = require('fs').promises;
const path = require('path');

class EventMenedzer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.dataPath = path.join(__dirname, '../data/eventy.json');
        this.data = null;
    }

    async initialize() {
        try {
            await this.loadData();
            this.logger.success('EventMenedzer zainicjalizowany');
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować EventMenedzer:', error);
            throw error;
        }
    }

    async loadData() {
        try {
            const fileContent = await fs.readFile(this.dataPath, 'utf8');
            this.data = JSON.parse(fileContent);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje, utwórz domyślną strukturę
                this.data = {
                    events: [],
                    listChannelId: null,
                    listMessageId: null,
                    controlPanelMessageId: null,
                    manualPanelMessageId: null,
                    nextId: 1
                };
                await this.saveData();
            } else {
                throw error;
            }
        }
    }

    async saveData() {
        try {
            await fs.writeFile(
                this.dataPath,
                JSON.stringify(this.data, null, 2),
                'utf8'
            );
        } catch (error) {
            this.logger.error('Nie udało się zapisać danych eventów:', error);
            throw error;
        }
    }

    generateId() {
        const id = this.data.nextId;
        this.data.nextId++;
        return id;
    }

    // ==================== EVENTY ====================

    // Utwórz event
    async createEvent(creatorId, name, firstTrigger, interval) {
        const id = this.generateId();

        let intervalMs = null;

        // Jeśli podano interwał, waliduj go
        if (interval && interval.trim() !== '') {
            // Waliduj interwał
            if (!this.validateInterval(interval)) {
                throw new Error('Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), lub "ee". Zostaw puste dla jednorazowego eventu.');
            }

            // Parsuj interwał na milisekundy
            intervalMs = this.parseInterval(interval);

            // Sprawdź maksymalny interwał (pomiń dla wzorca "ee")
            if (interval !== 'ee') {
                const maxInterval = 90 * 24 * 60 * 60 * 1000; // 90 dni w ms
                if (intervalMs > maxInterval) {
                    throw new Error('Interwał nie może przekraczać 90 dni');
                }
            }
        } else {
            // Brak interwału - jednorazowy event
            interval = null;
        }

        const event = {
            id: `evt_${id}`,
            name,
            creator: creatorId,
            createdAt: new Date().toISOString(),
            firstTrigger: new Date(firstTrigger).toISOString(),
            interval, // null dla jednorazowego
            intervalMs, // null dla jednorazowego
            nextTrigger: new Date(firstTrigger).toISOString(),
            triggerCount: 0, // Dla śledzenia wzorca "ee"
            isOneTime: interval === null // Flaga jednorazowego eventu
        };

        this.data.events.push(event);
        await this.saveData();

        this.logger.info(`Utworzono event: ${event.id} (${interval ? 'cykliczny' : 'jednorazowy'})`);
        return event;
    }

    // Waliduj format interwału
    // Zwraca true jeśli interwał jest pusty (jednorazowy) lub prawidłowy
    validateInterval(interval) {
        // Pusty interwał = jednorazowy event
        if (!interval || interval.trim() === '') {
            return true;
        }
        return /^\d+[smhd]$/.test(interval) || interval === 'ee';
    }

    // Parsuj interwał na milisekundy
    parseInterval(interval) {
        if (interval === 'ee') {
            return null; // Dynamiczny, obliczany per wyzwalacz
        }

        const match = interval.match(/^(\d+)([smhd])$/);
        if (!match) {
            throw new Error('Nieprawidłowy format interwału');
        }

        const value = parseInt(match[1]);
        const unit = match[2];

        switch (unit) {
            case 's': return value * 1000;
            case 'm': return value * 60 * 1000;
            case 'h': return value * 60 * 60 * 1000;
            case 'd': return value * 24 * 60 * 60 * 1000;
            default: throw new Error('Nieprawidłowa jednostka interwału');
        }
    }

    // Formatuj interwał do wyświetlenia
    formatInterval(interval) {
        // Jednorazowy event
        if (!interval || interval === null) {
            return 'Jednorazowy';
        }

        if (interval === 'ee') {
            return 'Wzorzec EE (3d x8, potem 4d, powtórz)';
        }

        const match = interval.match(/^(\d+)([smhd])$/);
        if (!match) return interval;

        const value = parseInt(match[1]);
        const unit = match[2];

        const units = {
            's': value === 1 ? 'sekunda' : value < 5 ? 'sekundy' : 'sekund',
            'm': value === 1 ? 'minuta' : value < 5 ? 'minuty' : 'minut',
            'h': value === 1 ? 'godzina' : value < 5 ? 'godziny' : 'godzin',
            'd': value === 1 ? 'dzień' : 'dni'
        };

        return `${value} ${units[unit]}`;
    }

    // Pobierz event po ID
    getEvent(id) {
        return this.data.events.find(e => e.id === id);
    }

    // Pobierz wszystkie eventy
    getAllEvents() {
        return this.data.events;
    }

    // Zaktualizuj event
    async updateEvent(id, updates) {
        const index = this.data.events.findIndex(e => e.id === id);
        if (index !== -1) {
            this.data.events[index] = {
                ...this.data.events[index],
                ...updates
            };
            await this.saveData();
            this.logger.info(`Zaktualizowano event: ${id}`);
            return true;
        }
        return false;
    }

    // Usuń event
    async deleteEvent(id) {
        const initialLength = this.data.events.length;
        this.data.events = this.data.events.filter(e => e.id !== id);

        if (this.data.events.length < initialLength) {
            await this.saveData();
            this.logger.info(`Usunięto event: ${id}`);
            return true;
        }
        return false;
    }

    // Zaktualizuj następne wyzwolenie dla eventu
    async updateNextTrigger(id) {
        const event = this.getEvent(id);
        if (!event) return false;

        // Jeśli to jednorazowy event, usuń go
        if (!event.interval || event.interval === null || event.isOneTime) {
            this.logger.info(`Jednorazowy event ${id} wykonany - usuwam z listy`);
            return await this.deleteEvent(id);
        }

        const lastTrigger = new Date(event.nextTrigger);
        let nextIntervalMs;
        let newTriggerCount = (event.triggerCount || 0) + 1;

        // Specjalny wzorzec "ee": 3d x8, potem 4d, powtórz
        if (event.interval === 'ee') {
            const cyclePosition = (event.triggerCount || 0) % 9;
            if (cyclePosition === 8) {
                nextIntervalMs = 4 * 24 * 60 * 60 * 1000; // 4 dni
            } else {
                nextIntervalMs = 3 * 24 * 60 * 60 * 1000; // 3 dni
            }
        } else {
            nextIntervalMs = event.intervalMs;
        }

        const nextTrigger = new Date(lastTrigger.getTime() + nextIntervalMs).toISOString();

        return await this.updateEvent(id, {
            nextTrigger,
            triggerCount: newTriggerCount
        });
    }

    // ==================== KANAŁ LISTY ====================

    // Ustaw kanał listy
    async setListChannel(channelId) {
        this.data.listChannelId = channelId;
        this.data.listMessageId = null; // Zresetuj ID wiadomości
        await this.saveData();
        this.logger.info(`Ustawiono kanał listy eventów: ${channelId}`);
    }

    // Pobierz ID kanału listy
    getListChannelId() {
        return this.data.listChannelId;
    }

    // Ustaw ID wiadomości listy
    async setListMessageId(messageId) {
        this.data.listMessageId = messageId;
        await this.saveData();
    }

    // Pobierz ID wiadomości listy
    getListMessageId() {
        return this.data.listMessageId;
    }

    // Ustaw ID wiadomości panelu kontrolnego
    async setControlPanelMessageId(messageId) {
        this.data.controlPanelMessageId = messageId;
        await this.saveData();
    }

    // Pobierz ID wiadomości panelu kontrolnego
    getControlPanelMessageId() {
        return this.data.controlPanelMessageId;
    }

    async setManualPanelMessageId(messageId) {
        this.data.manualPanelMessageId = messageId;
        await this.saveData();
    }

    getManualPanelMessageId() {
        return this.data.manualPanelMessageId;
    }
}

module.exports = EventMenedzer;
