const fs = require('fs').promises;
const path = require('path');

class TimelineService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.timelineDataFile = path.join(__dirname, '../data/timeline_data.json');
        this.lastUpdateFile = path.join(__dirname, '../data/last_update.json');
        this.messageId = null;
        this.channelId = '1407666612559024339';
        this.checkInterval = null;
        this.client = null;
        this.timelineData = [];
        this.lastUpdate = null;
    }

    /**
     * Inicjalizuje serwis timeline
     */
    async initialize(client) {
        this.client = client;
        await this.loadTimelineData();
        await this.loadLastUpdate();
        
        // Rozpocznij sprawdzanie co godzinę
        this.startHourlyCheck();
        
        // Opublikuj lub zaktualizuj wiadomość przy starcie
        await this.publishOrUpdateMessage();
        
        this.logger.info('TimelineService zainicjalizowany');
    }

    /**
     * Ładuje dane timeline z pliku
     */
    async loadTimelineData() {
        try {
            const data = await fs.readFile(this.timelineDataFile, 'utf8');
            const parsed = JSON.parse(data);
            this.timelineData = parsed.events || [];
            this.messageId = parsed.messageId || null;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Błąd wczytywania danych timeline:', error);
            }
            this.timelineData = [];
            this.messageId = null;
        }
    }

    /**
     * Zapisuje dane timeline do pliku
     */
    async saveTimelineData() {
        try {
            const data = {
                events: this.timelineData,
                messageId: this.messageId,
                lastSaved: new Date().toISOString()
            };
            await fs.writeFile(this.timelineDataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            this.logger.error('Błąd zapisywania danych timeline:', error);
        }
    }

    /**
     * Ładuje czas ostatniej aktualizacji
     */
    async loadLastUpdate() {
        try {
            const data = await fs.readFile(this.lastUpdateFile, 'utf8');
            const parsed = JSON.parse(data);
            this.lastUpdate = new Date(parsed.lastUpdate);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Błąd wczytywania czasu ostatniej aktualizacji:', error);
            }
            this.lastUpdate = null;
        }
    }

    /**
     * Zapisuje czas ostatniej aktualizacji
     */
    async saveLastUpdate() {
        try {
            const data = {
                lastUpdate: new Date().toISOString()
            };
            await fs.writeFile(this.lastUpdateFile, JSON.stringify(data, null, 2));
            this.lastUpdate = new Date();
        } catch (error) {
            this.logger.error('Błąd zapisywania czasu ostatniej aktualizacji:', error);
        }
    }

    /**
     * Pobiera dane timeline z garrytools.com
     */
    async fetchTimelineFromWeb() {
        const { WebFetch } = require('../utils/webFetch');
        
        try {
            const response = await WebFetch.fetch('https://garrytools.com/timeline');
            
            // Parsuj odpowiedź z HTML
            const events = this.parseTimelineFromHTML(response);
            return events;
        } catch (error) {
            this.logger.error('Błąd pobierania timeline z sieci:', error);
            // Zwróć domyślne dane jeśli nie można pobrać z sieci
            return this.getDefaultTimeline();
        }
    }

    /**
     * Parsuje timeline z HTML
     */
    parseTimelineFromHTML(htmlText) {
        try {
            // Najpierw spróbuj znaleźć tabelę timeline
            const events = [];
            
            // Szukaj wzorców dat w formacie "DD Month YYYY"
            const datePattern = /(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi;
            const timePattern = /(\d{2}:\d{2})/g;
            
            // Znajdź wszystkie daty
            const dates = htmlText.match(datePattern) || [];
            
            if (dates.length === 0) {
                this.logger.warn('Nie znaleziono dat w HTML, używam domyślnych danych');
                return this.getDefaultTimeline();
            }
            
            // Spróbuj wyciągnąć wydarzenia dla każdej daty
            dates.forEach(date => {
                // Znajdź sekcję tekstu po dacie
                const dateIndex = htmlText.indexOf(date);
                if (dateIndex === -1) return;
                
                // Wyciągnij tekst w okolicy tej daty (następne 500 znaków)
                const section = htmlText.substring(dateIndex, dateIndex + 500);
                
                // Znajdź czas
                const timeMatch = section.match(timePattern);
                const time = timeMatch ? timeMatch[0] : '16:00';
                
                // Znajdź opis wydarzenia - wszystko między czasem a następną datą
                let eventText = section.replace(date, '').replace(time, '').trim();
                // Weź pierwsze 200 znaków jako opis
                eventText = eventText.substring(0, 200).split('\n')[0].trim();
                
                if (eventText.length > 10) {
                    events.push({
                        date: date.trim(),
                        time: time,
                        event: eventText
                    });
                }
            });
            
            return events.length > 0 ? events : this.getDefaultTimeline();
            
        } catch (error) {
            this.logger.error('Błąd parsowania HTML timeline:', error);
            return this.getDefaultTimeline();
        }
    }

    /**
     * Zwraca domyślne dane timeline
     */
    getDefaultTimeline() {
        return [
            { date: '16 August 2025', time: '16:00', event: 'New Collection Items Released' },
            { date: '22 August 2025', time: '16:00', event: 'Additional Collection Items Available' },
            { date: '24 August 2025', time: '16:00', event: 'Universal Exchange Shop Opens' },
            { date: '28 August 2025', time: '16:00', event: 'SS Belt Chaos Fusion Feature Released' },
            { date: '3 September 2025', time: '16:00', event: 'New Collection Sets, Twinborn Tech Feature' },
            { date: '9 September 2025', time: '16:00', event: 'Amazing Diamond Carnival Package, New Collection Items' },
            { date: '11 September 2025', time: '16:00', event: 'Advanced Retreat Privileges Monthly Card Available' },
            { date: '15 September 2025', time: '16:00', event: 'Additional Collection Items Released' }
        ];
    }

    /**
     * Sprawdza czy są nowe dane i aktualizuje timeline
     */
    async checkForUpdates() {
        try {
            this.logger.info('Sprawdzanie aktualizacji timeline...');
            const newData = await this.fetchTimelineFromWeb();
            
            if (!newData) {
                this.logger.warn('Nie udało się pobrać nowych danych timeline');
                return false;
            }

            // Porównaj z istniejącymi danymi
            const hasChanges = this.compareTimelines(this.timelineData, newData);
            
            if (hasChanges) {
                this.logger.info('Znaleziono zmiany w timeline, aktualizuję...');
                this.timelineData = newData;
                await this.saveTimelineData();
                await this.saveLastUpdate();
                await this.publishOrUpdateMessage();
                return true;
            } else {
                this.logger.info('Brak zmian w timeline');
                return false;
            }
        } catch (error) {
            this.logger.error('Błąd sprawdzania aktualizacji timeline:', error);
            return false;
        }
    }

    /**
     * Porównuje dwa timeline
     */
    compareTimelines(oldData, newData) {
        if (!oldData || oldData.length !== newData.length) {
            return true;
        }

        for (let i = 0; i < oldData.length; i++) {
            const oldEvent = oldData[i];
            const newEvent = newData[i];
            
            if (oldEvent.date !== newEvent.date || 
                oldEvent.time !== newEvent.time || 
                oldEvent.event !== newEvent.event) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Generuje wiadomość timeline z odliczaniem
     */
    generateTimelineMessage() {
        const now = new Date();
        let message = '📅 **TIMELINE WYDARZEŃ** 📅\n\n';
        
        this.timelineData.forEach(event => {
            const eventDateTime = this.parseEventDateTime(event.date, event.time);
            const timeToEvent = this.formatTimeToEvent(now, eventDateTime);
            
            message += `**${event.date} ${event.time} UTC**\n`;
            message += `${event.event}\n`;
            message += `⏰ ${timeToEvent}\n\n`;
        });

        // Dodaj informację o ostatniej aktualizacji
        const lastUpdateStr = this.lastUpdate 
            ? this.formatDate(this.lastUpdate)
            : this.formatDate(now);
            
        message += `\n─────────────────────────────\n`;
        message += `📊 **Last Update Time:** ${lastUpdateStr}`;
        
        return message;
    }

    /**
     * Parsuje datę i czas wydarzenia
     */
    parseEventDateTime(dateStr, timeStr) {
        try {
            // Konwertuj datę w formacie "16 August 2025" na obiekt Date
            const [day, monthName, year] = dateStr.split(' ');
            const months = {
                'January': 0, 'February': 1, 'March': 2, 'April': 3,
                'May': 4, 'June': 5, 'July': 6, 'August': 7,
                'September': 8, 'October': 9, 'November': 10, 'December': 11
            };
            
            const [hour, minute] = timeStr.split(':').map(num => parseInt(num));
            
            return new Date(parseInt(year), months[monthName], parseInt(day), hour, minute);
        } catch (error) {
            this.logger.error(`Błąd parsowania daty: ${dateStr} ${timeStr}`, error);
            return new Date();
        }
    }

    /**
     * Formatuje czas do wydarzenia
     */
    formatTimeToEvent(now, eventTime) {
        const diff = eventTime - now;
        
        if (diff < 0) {
            return '✅ **Wydarzenie zakończone**';
        }
        
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
            return `⏳ **${days}d ${hours}h ${minutes}m**`;
        } else if (hours > 0) {
            return `⏳ **${hours}h ${minutes}m**`;
        } else {
            return `⏳ **${minutes}m**`;
        }
    }

    /**
     * Formatuje datę
     */
    formatDate(date) {
        const day = date.getDate().toString().padStart(2, '0');
        const month = date.toLocaleString('en', { month: 'long' });
        return `${day} ${month}`;
    }

    /**
     * Publikuje lub aktualizuje wiadomość na kanale
     */
    async publishOrUpdateMessage() {
        try {
            const channel = await this.client.channels.fetch(this.channelId);
            if (!channel) {
                this.logger.error(`Nie znaleziono kanału: ${this.channelId}`);
                return;
            }

            const messageContent = this.generateTimelineMessage();

            if (this.messageId) {
                // Spróbuj zaktualizować istniejącą wiadomość
                try {
                    const existingMessage = await channel.messages.fetch(this.messageId);
                    await existingMessage.edit(messageContent);
                    this.logger.info('Zaktualizowano wiadomość timeline');
                } catch (error) {
                    // Jeśli nie można zaktualizować, utwórz nową
                    this.logger.warn('Nie można zaktualizować wiadomości, tworzę nową:', error.message);
                    await this.createNewMessage(channel, messageContent);
                }
            } else {
                // Utwórz nową wiadomość
                await this.createNewMessage(channel, messageContent);
            }
        } catch (error) {
            this.logger.error('Błąd publikowania/aktualizacji wiadomości timeline:', error);
        }
    }

    /**
     * Tworzy nową wiadomość
     */
    async createNewMessage(channel, content) {
        try {
            const message = await channel.send(content);
            this.messageId = message.id;
            await this.saveTimelineData();
            this.logger.info('Utworzono nową wiadomość timeline');
        } catch (error) {
            this.logger.error('Błąd tworzenia nowej wiadomości:', error);
        }
    }

    /**
     * Uruchamia sprawdzanie co godzinę
     */
    startHourlyCheck() {
        // Sprawdzaj co godzinę (3600000 ms)
        this.checkInterval = setInterval(async () => {
            await this.checkForUpdates();
        }, 60 * 60 * 1000);
        
        this.logger.info('Uruchomiono sprawdzanie timeline co godzinę');
    }

    /**
     * Zatrzymuje sprawdzanie
     */
    stopHourlyCheck() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
            this.logger.info('Zatrzymano sprawdzanie timeline');
        }
    }
}

module.exports = TimelineService;