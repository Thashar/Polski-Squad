class StrefaCzasowaManager {
    constructor(logger) {
        this.logger = logger;
        this.timezone = 'Europe/Warsaw';
    }

    async initialize() {
    }

    getGlobalTimezone() {
        return this.timezone;
    }

    getCurrentTime() {
        const now = new Date();
        return now.toLocaleString('sv-SE', {
            timeZone: this.timezone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).replace(',', '');
    }
}

module.exports = StrefaCzasowaManager;
