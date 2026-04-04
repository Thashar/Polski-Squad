const fs = require('fs').promises;
const path = require('path');

const WARSAW_TZ = 'Europe/Warsaw';

// Pobierz składowe daty w strefie Warsaw (rok, miesiąc 1-indexed, dzień, godziny, minuty)
function getWarsawComponents(dateUTC) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: WARSAW_TZ,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
    }).formatToParts(dateUTC);
    const get = type => parseInt(parts.find(p => p.type === type).value);
    return {
        year: get('year'),
        month: get('month'),   // 1-indexed
        day: get('day'),
        hours: get('hour') % 24,
        minutes: get('minute'),
        seconds: get('second')
    };
}

// Konwertuj składowe Warsaw na UTC Date
function warsawComponentsToUTC(year, month1, day, hours, minutes, seconds = 0) {
    // Oblicz offset Warsaw: pobierz godzinę Warsaw przy północy UTC tej daty
    const refDate = new Date(Date.UTC(year, month1 - 1, day, 0, 0, 0));
    const tzParts = new Intl.DateTimeFormat('en-US', {
        timeZone: WARSAW_TZ, hour: '2-digit', hour12: false
    }).formatToParts(refDate);
    const warsawHourAtMidnight = parseInt(tzParts.find(p => p.type === 'hour').value) % 24;
    const offsetMs = warsawHourAtMidnight * 60 * 60 * 1000;
    // UTC = Warsaw_local - offset
    return new Date(Date.UTC(year, month1 - 1, day, hours, minutes, seconds) - offsetMs);
}

// Dodaj 1 miesiąc zachowując ten sam dzień i godzinę w strefie Warsaw
function addOneMonthWarsaw(dateUTC, originalDay) {
    const { year, month, hours, minutes, seconds } = getWarsawComponents(dateUTC);
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;
    const daysInNextMonth = new Date(nextYear, nextMonth, 0).getDate();
    const actualDay = Math.min(originalDay, daysInNextMonth);
    return warsawComponentsToUTC(nextYear, nextMonth, actualDay, hours, minutes, seconds);
}

class PrzypomnieniaMenedzer {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.dataPath = path.join(__dirname, '../data/przypomnienia.json');
        this.data = null;
    }

    async initialize() {
        try {
            await this.loadData();
            this.logger.success('PrzypomnieniaMenedzer zainicjalizowany');
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować PrzypomnieniaMenedzer:', error);
            throw error;
        }
    }

    async loadData() {
        try {
            const fileContent = await fs.readFile(this.dataPath, 'utf8');
            this.data = JSON.parse(fileContent);

            // Migracja danych - dodaj messagesToDelete jeśli nie istnieje
            if (!this.data.messagesToDelete) {
                this.data.messagesToDelete = [];
                await this.saveData();
                this.logger.info('Migracja danych: dodano pole messagesToDelete');
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje, utwórz domyślną strukturę
                this.data = {
                    templates: [],
                    scheduled: [],
                    messagesToDelete: [], // { messageId, channelId, deleteAt (timestamp) }
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
            this.logger.error('Nie udało się zapisać danych przypomnień:', error);
            throw error;
        }
    }

    generateId() {
        const id = this.data.nextId;
        this.data.nextId++;
        return id;
    }

    // ==================== SZABLONY ====================

    // Utwórz szablon (Tekst lub Embed)
    async createTemplate(creatorId, name, type, content) {
        const id = this.generateId();
        const template = {
            id: `tpl_${id}`,
            name,
            type, // 'text' lub 'embed'
            creator: creatorId,
            createdAt: new Date().toISOString(),
            ...content // { text } dla tekstu, { embedTitle, embedDescription, embedIcon, embedImage } dla embed
        };

        this.data.templates.push(template);
        await this.saveData();

        this.logger.info(`Utworzono szablon: ${template.id} (${type})`);
        return template;
    }

    // Pobierz szablon po ID
    getTemplate(id) {
        return this.data.templates.find(t => t.id === id);
    }

    // Pobierz wszystkie szablony
    getAllTemplates() {
        return this.data.templates;
    }

    // Pobierz szablony po twórcy
    getTemplatesByCreator(creatorId) {
        return this.data.templates.filter(t => t.creator === creatorId);
    }

    // Zaktualizuj szablon
    async updateTemplate(id, updates) {
        const index = this.data.templates.findIndex(t => t.id === id);
        if (index !== -1) {
            this.data.templates[index] = {
                ...this.data.templates[index],
                ...updates
            };
            await this.saveData();
            this.logger.info(`Zaktualizowano szablon: ${id}`);
            return true;
        }
        return false;
    }

    // Usuń szablon
    async deleteTemplate(id) {
        const initialLength = this.data.templates.length;
        this.data.templates = this.data.templates.filter(t => t.id !== id);

        if (this.data.templates.length < initialLength) {
            // Usuń również wszystkie zaplanowane przypomnienia używające tego szablonu
            this.data.scheduled = this.data.scheduled.filter(s => s.templateId !== id);
            await this.saveData();
            this.logger.info(`Usunięto szablon: ${id} i wszystkie powiązane zaplanowane przypomnienia`);
            return true;
        }
        return false;
    }

    // ==================== ZAPLANOWANE PRZYPOMNIENIA ====================

    // Utwórz zaplanowane przypomnienie
    async createScheduled(creatorId, templateId, firstTrigger, interval, channelId, roles = [], notificationType = 0) {
        const id = this.generateId();

        let intervalMs = null;

        // Jeśli podano interwał, waliduj go
        if (interval && interval.trim() !== '') {
            // Waliduj interwał
            if (!this.validateInterval(interval)) {
                throw new Error('Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 90d), lub "ee". Zostaw puste dla jednorazowego przypomnienia.');
            }

            // Parsuj interwał na milisekundy
            intervalMs = this.parseInterval(interval);

            // Sprawdź maksymalny interwał (pomiń dla wzorca "ee" i "monthly")
            if (interval !== 'ee' && interval !== 'monthly') {
                const maxInterval = 90 * 24 * 60 * 60 * 1000; // 90 dni w ms
                if (intervalMs > maxInterval) {
                    throw new Error('Interwał nie może przekraczać 90 dni');
                }
            }
        } else {
            // Brak interwału - jednorazowe przypomnienie
            interval = null;
        }

        // Dla interwału monthly - zapisz oryginalny dzień miesiąca (w strefie Warsaw)
        let monthlyDay = null;
        if (interval === 'monthly') {
            monthlyDay = getWarsawComponents(new Date(firstTrigger)).day;
        }

        const scheduled = {
            id: `sch_${id}`,
            templateId,
            creator: creatorId,
            createdAt: new Date().toISOString(),
            firstTrigger: new Date(firstTrigger).toISOString(),
            interval, // null dla jednorazowego
            intervalMs, // null dla jednorazowego
            monthlyDay, // dzień miesiąca dla interwału 'monthly'
            nextTrigger: new Date(firstTrigger).toISOString(),
            channelId,
            roles,
            status: 'active',
            boardMessageId: null,
            triggerCount: 0, // Dla śledzenia wzorca "ee"
            isOneTime: interval === null, // Flaga jednorazowego przypomnienia
            notificationType: parseInt(notificationType) || 0 // 0 = dopasowane, 1 = ustandaryzowane (auto-usuwanie po 23h 50min)
        };

        this.data.scheduled.push(scheduled);
        await this.saveData();

        this.logger.info(`Utworzono zaplanowane przypomnienie: ${scheduled.id} (szablon: ${templateId}, ${interval ? 'cykliczne' : 'jednorazowe'}, typ: ${notificationType})`);
        return scheduled;
    }

    // Waliduj format interwału (1s, 1m, 1h, 1d, lub "ee" dla specjalnego wzorca)
    // Zwraca true jeśli interwał jest pusty (jednorazowe) lub prawidłowy
    validateInterval(interval) {
        // Pusty interwał = jednorazowe przypomnienie
        if (!interval || interval.trim() === '') {
            return true;
        }
        return /^\d+[smhd]$/.test(interval) || interval === 'ee' || interval === 'monthly';
    }

    // Parsuj interwał na milisekundy
    parseInterval(interval) {
        // Specjalny wzorzec "ee" - dynamiczny interwał (3d x8, potem 4d, powtórz)
        if (interval === 'ee') {
            return null; // Dynamiczny, obliczany per wyzwalacz
        }

        // Miesięczny (ten sam dzień miesiąca)
        if (interval === 'monthly') {
            return null; // Kalendarzowy, obliczany per wyzwalacz
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
        // Jednorazowe przypomnienie
        if (!interval || interval === null) {
            return 'Jednorazowe';
        }

        // Miesięczny
        if (interval === 'monthly') {
            return 'Co miesiąc (ten sam dzień)';
        }

        // Specjalny wzorzec "ee"
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

    // Pobierz zaplanowane przypomnienie po ID
    getScheduled(id) {
        return this.data.scheduled.find(s => s.id === id);
    }

    // Pobierz wszystkie zaplanowane przypomnienia
    getAllScheduled() {
        return this.data.scheduled;
    }

    // Pobierz aktywne zaplanowane przypomnienia
    getActiveScheduled() {
        return this.data.scheduled.filter(s => s.status === 'active');
    }

    // Pobierz zaplanowane przypomnienia po twórcy
    getScheduledByCreator(creatorId) {
        return this.data.scheduled.filter(s => s.creator === creatorId);
    }

    // Pobierz zaplanowane przypomnienia po szablonie
    getScheduledByTemplate(templateId) {
        return this.data.scheduled.filter(s => s.templateId === templateId);
    }

    // Zaktualizuj zaplanowane przypomnienie
    async updateScheduled(id, updates) {
        const index = this.data.scheduled.findIndex(s => s.id === id);
        if (index !== -1) {
            this.data.scheduled[index] = {
                ...this.data.scheduled[index],
                ...updates
            };
            await this.saveData();
            this.logger.info(`Zaktualizowano zaplanowane przypomnienie: ${id}`);
            return true;
        }
        return false;
    }

    // Usuń zaplanowane przypomnienie
    async deleteScheduled(id) {
        const initialLength = this.data.scheduled.length;
        this.data.scheduled = this.data.scheduled.filter(s => s.id !== id);

        if (this.data.scheduled.length < initialLength) {
            await this.saveData();
            this.logger.info(`Usunięto zaplanowane przypomnienie: ${id}`);
            return true;
        }
        return false;
    }

    // Wstrzymaj zaplanowane przypomnienie
    async pauseScheduled(id) {
        return await this.updateScheduled(id, { status: 'paused' });
    }

    // Wznów zaplanowane przypomnienie
    async resumeScheduled(id) {
        return await this.updateScheduled(id, { status: 'active' });
    }

    // Zaktualizuj następne wyzwolenie dla zaplanowanego przypomnienia
    async updateNextTrigger(id) {
        const scheduled = this.getScheduled(id);
        if (!scheduled) return false;

        // Jeśli to jednorazowe przypomnienie, oznacz jako zakończone
        if (!scheduled.interval || scheduled.interval === null || scheduled.isOneTime) {
            this.logger.info(`Jednorazowe przypomnienie ${id} wykonane - oznaczam jako zakończone`);
            return await this.updateScheduled(id, {
                status: 'completed',
                triggerCount: 1
            });
        }

        const lastTrigger = new Date(scheduled.nextTrigger);
        let nextTrigger;
        let newTriggerCount = (scheduled.triggerCount || 0) + 1;

        // Miesięczny (ten sam dzień miesiąca, ta sama godzina w Warsaw)
        if (scheduled.interval === 'monthly') {
            const originalDay = scheduled.monthlyDay || getWarsawComponents(lastTrigger).day;
            nextTrigger = addOneMonthWarsaw(lastTrigger, originalDay).toISOString();
        } else {
            let nextIntervalMs;
            // Specjalny wzorzec "ee": 3d x8, potem 4d, powtórz
            if (scheduled.interval === 'ee') {
                const cyclePosition = (scheduled.triggerCount || 0) % 9;
                if (cyclePosition === 8) {
                    nextIntervalMs = 4 * 24 * 60 * 60 * 1000;
                } else {
                    nextIntervalMs = 3 * 24 * 60 * 60 * 1000;
                }
            } else {
                nextIntervalMs = scheduled.intervalMs;
            }
            nextTrigger = new Date(lastTrigger.getTime() + nextIntervalMs).toISOString();
        }

        return await this.updateScheduled(id, {
            nextTrigger,
            triggerCount: newTriggerCount
        });
    }

    // Zaktualizuj ID wiadomości tablicy
    async updateBoardMessageId(id, messageId) {
        return await this.updateScheduled(id, { boardMessageId: messageId });
    }

    // Pobierz zaplanowane przypomnienie z danymi szablonu
    getScheduledWithTemplate(id) {
        const scheduled = this.getScheduled(id);
        if (!scheduled) return null;

        const template = this.getTemplate(scheduled.templateId);
        if (!template) return null;

        return {
            ...scheduled,
            template
        };
    }

    // Pobierz wszystkie zaplanowane z szablonami
    getAllScheduledWithTemplates() {
        return this.data.scheduled.map(s => ({
            ...s,
            template: this.getTemplate(s.templateId)
        })).filter(s => s.template !== undefined);
    }

    // Pobierz liczbę aktywnych zaplanowanych na użytkownika
    getActiveCountByUser(userId) {
        return this.data.scheduled.filter(
            s => s.creator === userId && s.status === 'active'
        ).length;
    }

    // Pobierz całkowitą liczbę aktywnych zaplanowanych
    getTotalActiveCount() {
        return this.data.scheduled.filter(s => s.status === 'active').length;
    }

    // ==================== WIADOMOŚCI DO USUNIĘCIA (TYP 1 - USTANDARYZOWANE) ====================

    // Dodaj wiadomość do usunięcia po 23h 50min
    async addMessageToDelete(messageId, channelId) {
        const deleteAt = Date.now() + (23 * 60 * 60 * 1000 + 50 * 60 * 1000); // 23h 50min

        this.data.messagesToDelete.push({
            messageId,
            channelId,
            deleteAt
        });

        await this.saveData();
        this.logger.info(`Zaplanowano usunięcie wiadomości ${messageId} o ${new Date(deleteAt).toLocaleString()}`);
    }

    // Pobierz wiadomości do usunięcia (starsze niż deleteAt)
    getMessagesToDeleteNow() {
        const now = Date.now();
        return this.data.messagesToDelete.filter(m => m.deleteAt <= now);
    }

    // Usuń wiadomość z listy do usunięcia
    async removeMessageFromDeleteList(messageId) {
        this.data.messagesToDelete = this.data.messagesToDelete.filter(m => m.messageId !== messageId);
        await this.saveData();
    }
}

module.exports = PrzypomnieniaMenedzer;
