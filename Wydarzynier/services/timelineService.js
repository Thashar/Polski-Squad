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
            this.logger.info('Rozpoczynam parsowanie HTML timeline...');
            
            // Szukaj tabel lub struktur zawierających dane timeline
            const events = [];
            
            // Spróbuj znaleźć tabelę timeline - szukaj różnych wzorców
            const tablePatterns = [
                // Wzorzec dla tabeli z klasami
                /<table[^>]*class[^>]*timeline[^>]*>[\s\S]*?<\/table>/gi,
                /<table[^>]*>[\s\S]*?<\/table>/gi,
                // Wzorzec dla div z danymi timeline
                /<div[^>]*class[^>]*timeline[^>]*>[\s\S]*?<\/div>/gi
            ];
            
            let tableContent = '';
            for (const pattern of tablePatterns) {
                const matches = htmlText.match(pattern);
                if (matches && matches.length > 0) {
                    tableContent = matches[0];
                    this.logger.info(`Znaleziono strukturę timeline za pomocą wzorca: ${pattern.source.substring(0, 50)}...`);
                    break;
                }
            }
            
            // Jeśli nie znaleziono tabeli, spróbuj przeszukać cały tekst
            if (!tableContent) {
                this.logger.warn('Nie znaleziono tabeli timeline, przeszukuję cały tekst...');
                tableContent = htmlText;
            }
            
            // Ulepszone wzorce dla dat i czasów
            const datePatterns = [
                // Wzorzec "16 August 2025"
                /(\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})/gi,
                // Wzorzec "16 Aug 2025"  
                /(\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/gi,
                // Wzorzec "2025-08-16"
                /(\d{4}-\d{2}-\d{2})/g
            ];
            
            let foundDates = [];
            
            // Przeszukaj wszystkimi wzorcami dat
            for (const pattern of datePatterns) {
                const matches = tableContent.match(pattern) || [];
                if (matches.length > 0) {
                    foundDates = foundDates.concat(matches);
                    this.logger.info(`Znaleziono ${matches.length} dat wzorcem: ${pattern.source}`);
                }
            }
            
            // Usuń duplikaty
            foundDates = [...new Set(foundDates)];
            
            if (foundDates.length === 0) {
                this.logger.warn('Nie znaleziono żadnych dat, sprawdzam surowy tekst...');
                // Szukaj dowolnych dat w tekście
                const rawDatePattern = /\d{1,2}.*?(August|September|October|November|December|January|February|March|April|May|June|July).*?\d{4}/gi;
                foundDates = tableContent.match(rawDatePattern) || [];
                this.logger.info(`Znaleziono ${foundDates.length} surowych dat`);
            }
            
            this.logger.info(`Łącznie znaleziono dat: ${foundDates.length}`);
            
            // Parsuj każdą znalezioną datę
            foundDates.forEach((date, index) => {
                try {
                    // Znajdź pozycję daty w tekście
                    const dateIndex = tableContent.indexOf(date);
                    if (dateIndex === -1) return;
                    
                    // Wyciągnij sekcję wokół daty (1000 znaków)
                    const section = tableContent.substring(Math.max(0, dateIndex - 200), dateIndex + 800);
                    
                    // Szukaj czasów w formacie HH:MM
                    const timePattern = /\b(\d{1,2}):(\d{2})\b/g;
                    const timeMatches = section.match(timePattern);
                    
                    let time = '16:00'; // domyślny czas
                    if (timeMatches) {
                        // Weź najbliższy czas do daty
                        time = timeMatches[0];
                    }
                    
                    // Szukaj tekstu po czasie lub po dacie
                    const afterDateText = tableContent.substring(dateIndex + date.length, dateIndex + date.length + 500);
                    
                    // Oczyść tekst z HTML i niepotrzebnych znaków
                    let cleanText = afterDateText
                        .replace(/<[^>]*>/g, ' ') // usuń HTML
                        .replace(/\s+/g, ' ') // znormalizuj białe znaki
                        .replace(time, '') // usuń czas
                        .replace(/\(UTC\s*\d*\)/, '') // usuń (UTC 0)
                        .replace(/✔️|❌|⏰|📅/g, '') // usuń emoji
                        .replace(/^[-\s]*/, '') // usuń myślniki na początku
                        .trim();
                    
                    // Znajdź znaczące opisy wydarzeń
                    let eventDescription = '';
                    
                    // Szukaj konkretnych słów kluczowych dla wydarzeń
                    const keywordPatterns = [
                        /New Collection.*?(?=\.|$)/gi,
                        /Additional Collection.*?(?=\.|$)/gi,
                        /Universal Exchange Shop.*?(?=\.|$)/gi,
                        /SS Belt.*?(?=\.|$)/gi,
                        /Amazing Diamond.*?(?=\.|$)/gi,
                        /Advanced Retreat.*?(?=\.|$)/gi,
                        /Twinborn Tech.*?(?=\.|$)/gi,
                        /Released.*?(?=\.|$)/gi
                    ];
                    
                    for (const pattern of keywordPatterns) {
                        const match = cleanText.match(pattern);
                        if (match && match[0]) {
                            eventDescription = match[0].trim();
                            break;
                        }
                    }
                    
                    // Jeśli nie znaleziono wzorca, weź pierwszą sensowną część
                    if (!eventDescription) {
                        const sentences = cleanText.split(/[.!?|\n]/);
                        for (const sentence of sentences) {
                            if (sentence.trim().length > 10 && !sentence.match(/^\d+$/) && !sentence.includes('UTC')) {
                                eventDescription = sentence.trim();
                                break;
                            }
                        }
                    }
                    
                    // Jeśli nadal nie ma opisu, weź pierwsze 80 znaków
                    if (!eventDescription && cleanText.length > 10) {
                        eventDescription = cleanText.substring(0, 80).trim();
                    }
                    
                    // Oczyść ostateczny opis
                    eventDescription = eventDescription
                        .replace(/^[-\s]*/, '')
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    // Normalizuj format daty
                    let normalizedDate = date.trim();
                    
                    // Konwertuj krótkie nazwy miesięcy na pełne i napraw duplikaty
                    const monthMap = {
                        'Jan': 'January', 'Feb': 'February', 'Mar': 'March', 'Apr': 'April',
                        'May': 'May', 'Jun': 'June', 'Jul': 'July', 'Aug': 'August',
                        'Sep': 'September', 'Oct': 'October', 'Nov': 'November', 'Dec': 'December'
                    };
                    
                    for (const [short, full] of Object.entries(monthMap)) {
                        normalizedDate = normalizedDate.replace(short, full);
                    }
                    
                    // Napraw błędne duplikowanie miesięcy (np. "Augustust" -> "August")
                    normalizedDate = normalizedDate.replace(/([A-Za-z]+)\1+/g, '$1');
                    // Napraw "Septembertember" -> "September"
                    normalizedDate = normalizedDate.replace(/Septembertember/g, 'September');
                    
                    if (eventDescription.length > 5) {
                        events.push({
                            date: normalizedDate,
                            time: time,
                            event: eventDescription
                        });
                        
                        this.logger.info(`Dodano wydarzenie: ${normalizedDate} ${time} - ${eventDescription.substring(0, 50)}...`);
                    }
                    
                } catch (parseError) {
                    this.logger.error(`Błąd parsowania daty ${date}:`, parseError);
                }
            });
            
            this.logger.info(`Sparsowano ${events.length} wydarzeń z HTML`);
            
            if (events.length > 0) {
                return events;
            } else {
                this.logger.warn('Nie udało się sparsować wydarzeń, używam domyślnych danych');
                return this.getDefaultTimeline();
            }
            
        } catch (error) {
            this.logger.error('Błąd parsowania HTML timeline:', error);
            return this.getDefaultTimeline();
        }
    }

    /**
     * Zwraca domyślne dane timeline (fallback gdy nie można pobrać z sieci)
     */
    getDefaultTimeline() {
        return [
            { date: '16 August 2025', time: '16:00', event: 'New Collection Items Released, New Collection Sets, New Costumes' },
            { date: '22 August 2025', time: '16:00', event: 'Additional Collection Items Released' },
            { date: '24 August 2025', time: '16:00', event: 'Universal Exchange Shop Opens' },
            { date: '28 August 2025', time: '16:00', event: 'SS Belt Chaos Fusion Feature Released' },
            { date: '3 September 2025', time: '16:00', event: 'New Collection Sets, "Twinborn Tech (Lightning + Boomerang)" Feature' },
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
            this.logger.info(`Próbuję pobrać kanał: ${this.channelId}`);
            const channel = await this.client.channels.fetch(this.channelId);
            
            if (!channel) {
                this.logger.error(`❌ Nie znaleziono kanału: ${this.channelId}`);
                return;
            }
            
            this.logger.info(`✅ Znaleziono kanał: ${channel.name} (${channel.type})`);
            
            // Sprawdź uprawnienia bota
            if (channel.guild) {
                const permissions = channel.permissionsFor(this.client.user);
                this.logger.info(`Uprawnienia bota: SendMessages: ${permissions.has('SendMessages')}, ViewChannel: ${permissions.has('ViewChannel')}`);
                
                if (!permissions.has('SendMessages')) {
                    this.logger.error('❌ Bot nie ma uprawnień do wysyłania wiadomości na tym kanale');
                    return;
                }
            }

            const messageContent = this.generateTimelineMessage();
            
            // Sprawdź długość wiadomości (limit Discord: 2000 znaków)
            if (messageContent.length > 2000) {
                this.logger.warn(`Wiadomość jest za długa (${messageContent.length} znaków), skracam...`);
                const shortContent = messageContent.substring(0, 1950) + '\n\n[...]';
                await this.createNewMessage(channel, shortContent);
                return;
            }

            if (this.messageId) {
                // Spróbuj zaktualizować istniejącą wiadomość
                try {
                    const existingMessage = await channel.messages.fetch(this.messageId);
                    await existingMessage.edit(messageContent);
                    this.logger.info('✅ Zaktualizowano wiadomość timeline');
                } catch (error) {
                    // Jeśli nie można zaktualizować, utwórz nową
                    this.logger.warn(`⚠️ Nie można zaktualizować wiadomości (${error.message}), tworzę nową`);
                    await this.createNewMessage(channel, messageContent);
                }
            } else {
                // Utwórz nową wiadomość
                this.logger.info('Tworzę nową wiadomość timeline');
                await this.createNewMessage(channel, messageContent);
            }
        } catch (error) {
            this.logger.error('❌ Błąd publikowania/aktualizacji wiadomości timeline:', error);
            this.logger.error('Szczegóły błędu:', {
                name: error.name,
                message: error.message,
                code: error.code,
                status: error.status
            });
        }
    }

    /**
     * Tworzy nową wiadomość
     */
    async createNewMessage(channel, content) {
        try {
            this.logger.info(`Próbuję utworzyć wiadomość na kanale ${channel.name} (${channel.id})`);
            this.logger.info(`Długość wiadomości: ${content.length} znaków`);
            
            const message = await channel.send(content);
            this.messageId = message.id;
            await this.saveTimelineData();
            this.logger.info(`✅ Utworzono nową wiadomość timeline (ID: ${message.id})`);
        } catch (error) {
            this.logger.error('Błąd tworzenia nowej wiadomości:', error);
            this.logger.error('Szczegóły błędu:', {
                name: error.name,
                message: error.message,
                code: error.code,
                status: error.status
            });
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