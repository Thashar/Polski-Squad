const fs = require('fs').promises;
const path = require('path');

class StrefaCzasowaManager {
    constructor(logger) {
        this.logger = logger;
        this.dataPath = path.join(__dirname, '../data/strefy_czasowe.json');
        this.timezones = null;
    }

    async initialize() {
        try {
            await this.loadData();
            this.logger.success('StrefaCzasowaManager zainicjalizowany');
        } catch (error) {
            this.logger.error('Nie udało się zainicjalizować StrefaCzasowaManager:', error);
            throw error;
        }
    }

    async loadData() {
        try {
            const fileContent = await fs.readFile(this.dataPath, 'utf8');
            this.timezones = JSON.parse(fileContent);
        } catch (error) {
            if (error.code === 'ENOENT') {
                this.timezones = { timezone: 'Europe/Warsaw' };
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
                JSON.stringify(this.timezones, null, 2),
                'utf8'
            );
        } catch (error) {
            this.logger.error('Nie udało się zapisać danych strefy czasowej:', error);
            throw error;
        }
    }

    // Pobierz globalną strefę czasową bota
    getGlobalTimezone() {
        return this.timezones.timezone || 'Europe/Warsaw';
    }

    // Ustaw globalną strefę czasową bota
    async setGlobalTimezone(timezone) {
        this.timezones.timezone = timezone;
        await this.saveData();
        this.logger.info(`Ustawiono strefę czasową bota: ${timezone}`);
    }

    // Pobierz aktualny czas w strefie czasowej bota
    getCurrentTime() {
        const timezone = this.getGlobalTimezone();
        const now = new Date();

        try {
            return now.toLocaleString('sv-SE', {
                timeZone: timezone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }).replace(',', '');
        } catch (error) {
            // Fallback do Europe/Warsaw jeśli strefa czasowa jest nieprawidłowa
            this.logger.warn(`Nieprawidłowa strefa czasowa ${timezone}, używanie Europe/Warsaw`);
            return now.toLocaleString('sv-SE', {
                timeZone: 'Europe/Warsaw',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
            }).replace(',', '');
        }
    }

    // Dodatnie strefy czasowe (UTC+00:00 i wyższe)
    getPositiveTimezones() {
        return [
            { label: 'UTC (UTC+00:00)', value: 'UTC' },
            { label: 'Londyn (UTC+00:00)', value: 'Europe/London' },
            { label: 'Berlin (UTC+01:00)', value: 'Europe/Berlin' },
            { label: 'Warszawa (UTC+01:00)', value: 'Europe/Warsaw' },
            { label: 'Paryż (UTC+01:00)', value: 'Europe/Paris' },
            { label: 'Rzym (UTC+01:00)', value: 'Europe/Rome' },
            { label: 'Ateny (UTC+02:00)', value: 'Europe/Athens' },
            { label: 'Helsinki (UTC+02:00)', value: 'Europe/Helsinki' },
            { label: 'Stambuł (UTC+03:00)', value: 'Europe/Istanbul' },
            { label: 'Moskwa (UTC+03:00)', value: 'Europe/Moscow' },
            { label: 'Dubaj (UTC+04:00)', value: 'Asia/Dubai' },
            { label: 'Karaczi (UTC+05:00)', value: 'Asia/Karachi' },
            { label: 'Dhaka (UTC+06:00)', value: 'Asia/Dhaka' },
            { label: 'Bangkok (UTC+07:00)', value: 'Asia/Bangkok' },
            { label: 'Hongkong (UTC+08:00)', value: 'Asia/Hong_Kong' },
            { label: 'Singapur (UTC+08:00)', value: 'Asia/Singapore' },
            { label: 'Tokio (UTC+09:00)', value: 'Asia/Tokyo' },
            { label: 'Seul (UTC+09:00)', value: 'Asia/Seoul' },
            { label: 'Sydney (UTC+10:00)', value: 'Australia/Sydney' },
            { label: 'Melbourne (UTC+10:00)', value: 'Australia/Melbourne' },
            { label: 'Auckland (UTC+12:00)', value: 'Pacific/Auckland' }
        ];
    }

    // Ujemne strefy czasowe (UTC-01:00 i niższe)
    getNegativeTimezones() {
        return [
            { label: 'Azory (UTC-01:00)', value: 'Atlantic/Azores' },
            { label: 'São Paulo (UTC-03:00)', value: 'America/Sao_Paulo' },
            { label: 'Buenos Aires (UTC-03:00)', value: 'America/Argentina/Buenos_Aires' },
            { label: 'Santiago (UTC-04:00)', value: 'America/Santiago' },
            { label: 'Nowy Jork (UTC-05:00)', value: 'America/New_York' },
            { label: 'Toronto (UTC-05:00)', value: 'America/Toronto' },
            { label: 'Chicago (UTC-06:00)', value: 'America/Chicago' },
            { label: 'Meksyk (UTC-06:00)', value: 'America/Mexico_City' },
            { label: 'Denver (UTC-07:00)', value: 'America/Denver' },
            { label: 'Phoenix (UTC-07:00)', value: 'America/Phoenix' },
            { label: 'Los Angeles (UTC-08:00)', value: 'America/Los_Angeles' },
            { label: 'Vancouver (UTC-08:00)', value: 'America/Vancouver' },
            { label: 'Anchorage (UTC-09:00)', value: 'America/Anchorage' },
            { label: 'Honolulu (UTC-10:00)', value: 'Pacific/Honolulu' }
        ];
    }
}

module.exports = StrefaCzasowaManager;
