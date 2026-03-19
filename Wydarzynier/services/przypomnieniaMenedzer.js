const fs = require('fs').promises;
const path = require('path');

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
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Plik nie istnieje, utwórz domyślną strukturę
                this.data = {
                    templates: [],
                    scheduled: [],
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
    async createScheduled(creatorId, templateId, firstTrigger, interval, channelId, roles = []) {
        const id = this.generateId();

        // Waliduj interwał
        if (!this.validateInterval(interval)) {
            throw new Error('Nieprawidłowy format interwału. Użyj: 1s, 1m, 1h, 1d (max 28d), lub "ee"');
        }

        // Parsuj interwał na milisekundy
        const intervalMs = this.parseInterval(interval);

        // Sprawdź maksymalny interwał (pomiń dla wzorca "ee")
        if (interval !== 'ee') {
            const maxInterval = 28 * 24 * 60 * 60 * 1000; // 28 dni w ms
            if (intervalMs > maxInterval) {
                throw new Error('Interwał nie może przekraczać 28 dni');
            }
        }

        const scheduled = {
            id: `sch_${id}`,
            templateId,
            creator: creatorId,
            createdAt: new Date().toISOString(),
            firstTrigger: new Date(firstTrigger).toISOString(),
            interval,
            intervalMs,
            nextTrigger: new Date(firstTrigger).toISOString(),
            channelId,
            roles,
            status: 'active',
            boardMessageId: null,
            triggerCount: 0 // Dla śledzenia wzorca "ee"
        };

        this.data.scheduled.push(scheduled);
        await this.saveData();

        this.logger.info(`Utworzono zaplanowane przypomnienie: ${scheduled.id} (szablon: ${templateId})`);
        return scheduled;
    }

    // Waliduj format interwału (1s, 1m, 1h, 1d, lub "ee" dla specjalnego wzorca)
    validateInterval(interval) {
        return /^\d+[smhd]$/.test(interval) || interval === 'ee';
    }

    // Parsuj interwał na milisekundy
    parseInterval(interval) {
        // Specjalny wzorzec "ee" - dynamiczny interwał (3d x8, potem 4d, powtórz)
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

        const lastTrigger = new Date(scheduled.nextTrigger);
        let nextIntervalMs;
        let newTriggerCount = (scheduled.triggerCount || 0) + 1;

        // Specjalny wzorzec "ee": 3d x8, potem 4d, powtórz
        if (scheduled.interval === 'ee') {
            const cyclePosition = (scheduled.triggerCount || 0) % 9;
            // Pozycje 0-7 (pierwsze 8 wyzwoleń): 3 dni
            // Pozycja 8 (9-te wyzwolenie): 4 dni
            if (cyclePosition === 8) {
                nextIntervalMs = 4 * 24 * 60 * 60 * 1000; // 4 dni
            } else {
                nextIntervalMs = 3 * 24 * 60 * 60 * 1000; // 3 dni
            }
        } else {
            nextIntervalMs = scheduled.intervalMs;
        }

        const nextTrigger = new Date(lastTrigger.getTime() + nextIntervalMs).toISOString();

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
}

module.exports = PrzypomnieniaMenedzer;
