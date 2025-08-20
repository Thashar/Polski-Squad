const fs = require('fs').promises;
const path = require('path');

class TimelineService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.timelineDataFile = path.join(__dirname, '../data/timeline_data.json');
        this.lastUpdateFile = path.join(__dirname, '../data/last_update.json');
        this.eventsLogFile = path.join(__dirname, '../data/events_log.json');
        this.messageIds = []; // Tablica ID wiadomości dla każdego wydarzenia
        this.channelId = '1407666612559024339';
        this.eventsLog = []; // Historia wszystkich wydarzeń
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
        await this.loadEventsLog();
        
        // Rozpocznij sprawdzanie co godzinę
        this.startHourlyCheck();
        
        // Opublikuj lub zaktualizuj wiadomości przy starcie
        await this.publishOrUpdateMessages();
        
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
            this.messageIds = parsed.messageIds || [];
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Błąd wczytywania danych timeline:', error);
            }
            this.timelineData = [];
            this.messageIds = [];
        }
    }

    /**
     * Zapisuje dane timeline do pliku
     */
    async saveTimelineData() {
        try {
            const data = {
                events: this.timelineData,
                messageIds: this.messageIds,
                lastSaved: new Date().toISOString()
            };
            await fs.writeFile(this.timelineDataFile, JSON.stringify(data, null, 2));
        } catch (error) {
            this.logger.error('Błąd zapisywania danych timeline:', error);
        }
    }

    /**
     * Ładuje log wszystkich wydarzeń
     */
    async loadEventsLog() {
        try {
            const data = await fs.readFile(this.eventsLogFile, 'utf8');
            this.eventsLog = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                this.logger.error('Błąd wczytywania logu wydarzeń:', error);
            }
            this.eventsLog = [];
        }
    }

    /**
     * Zapisuje log wszystkich wydarzeń
     */
    async saveEventsLog() {
        try {
            await fs.writeFile(this.eventsLogFile, JSON.stringify(this.eventsLog, null, 2));
        } catch (error) {
            this.logger.error('Błąd zapisywania logu wydarzeń:', error);
        }
    }

    /**
     * Dodaje wydarzenie do logu
     */
    async logEvent(event, changeType = 'update') {
        const logEntry = {
            timestamp: new Date().toISOString(),
            changeType: changeType, // 'new', 'update', 'delete'
            event: { ...event },
            source: 'garrytools.com/timeline'
        };
        
        this.eventsLog.push(logEntry);
        
        // Zachowaj tylko ostatnie 1000 wpisów
        if (this.eventsLog.length > 1000) {
            this.eventsLog = this.eventsLog.slice(-1000);
        }
        
        await this.saveEventsLog();
        this.logger.info(`Zalogowano wydarzenie: ${changeType} - ${event.event?.substring(0, 50)}...`);
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
                    
                    // Wyciągnij rozszerzoną sekcję wydarzenia - większy blok (2000 znaków)
                    let extendedSection = tableContent.substring(dateIndex, dateIndex + 2000);
                    
                    // Znajdź koniec tego wydarzenia (następna data lub koniec tekstu)
                    const nextDateMatch = extendedSection.match(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g);
                    if (nextDateMatch && nextDateMatch.length > 1) {
                        // Znajdź pozycję drugiej daty
                        const secondDateIndex = extendedSection.indexOf(nextDateMatch[1]);
                        if (secondDateIndex > 100) {
                            extendedSection = extendedSection.substring(0, secondDateIndex);
                        }
                    }
                    
                    // Zachowaj oryginalną strukturę z sekcjami
                    let rawEventContent = extendedSection
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // usuń skrypty
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // usuń style
                        .replace(/<img[^>]*>/gi, '') // usuń obrazki
                        .replace(/<[^>]*>/g, ' ') // usuń pozostałe tagi HTML
                        .replace(/This website has been created to guide players.*?Soon\.\.\./gs, '') // usuń stopkę strony
                        .replace(/kaliqq47856@proton\.me/g, '') // usuń email
                        .replace(/Privacy Policy/g, '') // usuń politykę prywatności
                        .replace(/❤️/g, '') // usuń serce ze stopki
                        .replace(/\s+/g, ' ') // znormalizuj białe znaki
                        .trim();
                    
                    // Znajdź i zachowaj strukturę sekcji
                    const structuredContent = this.extractStructuredContent(rawEventContent);
                    let eventDescription = structuredContent || rawEventContent.substring(0, 500).trim();
                    
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
                await this.publishOrUpdateMessages();
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
     * Porównuje dwa timeline i loguje zmiany
     */
    async compareTimelines(oldData, newData) {
        if (!oldData || oldData.length === 0) {
            // Pierwsza inicjalizacja - zaloguj wszystkie wydarzenia jako nowe
            for (const event of newData) {
                await this.logEvent(event, 'new');
            }
            return true;
        }

        let hasChanges = false;
        const changes = [];

        // Sprawdź usunięte wydarzenia
        for (const oldEvent of oldData) {
            const found = newData.find(newEvent => 
                newEvent.date === oldEvent.date && 
                newEvent.time === oldEvent.time
            );
            if (!found) {
                changes.push({ type: 'deleted', event: oldEvent });
                await this.logEvent(oldEvent, 'delete');
                hasChanges = true;
            }
        }

        // Sprawdź nowe i zmienione wydarzenia
        for (const newEvent of newData) {
            const oldEvent = oldData.find(old => 
                old.date === newEvent.date && 
                old.time === newEvent.time
            );
            
            if (!oldEvent) {
                // Nowe wydarzenie
                changes.push({ type: 'added', event: newEvent });
                await this.logEvent(newEvent, 'new');
                hasChanges = true;
            } else if (oldEvent.event !== newEvent.event) {
                // Zmienione wydarzenie
                changes.push({ 
                    type: 'modified', 
                    oldEvent: oldEvent, 
                    newEvent: newEvent 
                });
                await this.logEvent(newEvent, 'update');
                hasChanges = true;
            }
        }

        // Loguj podsumowanie zmian
        if (hasChanges) {
            this.logger.info(`Znaleziono ${changes.length} zmian w timeline:`);
            changes.forEach((change, index) => {
                switch(change.type) {
                    case 'added':
                        this.logger.info(`  ${index + 1}. ➕ DODANO: ${change.event.date} - ${change.event.event.substring(0, 50)}...`);
                        break;
                    case 'deleted':
                        this.logger.info(`  ${index + 1}. ➖ USUNIĘTO: ${change.event.date} - ${change.event.event.substring(0, 50)}...`);
                        break;
                    case 'modified':
                        this.logger.info(`  ${index + 1}. 🔄 ZMIENIONO: ${change.newEvent.date} - ${change.newEvent.event.substring(0, 50)}...`);
                        break;
                }
            });
        }

        return hasChanges;
    }

    /**
     * Generuje wiadomość dla pojedynczego wydarzenia
     */
    generateEventMessage(event) {
        const eventDateTime = this.parseEventDateTime(event.date, event.time);
        const timestamp = Math.floor(eventDateTime.getTime() / 1000);
        
        // Discord timestamp format - automatyczne odliczanie
        const discordTimestamp = `<t:${timestamp}:R>`; // Relative time (np. "in 2 days")
        const discordDate = `<t:${timestamp}:F>`; // Full date and time
        
        // Sformatuj wydarzenie zgodnie ze strukturą HTML
        let formattedEvent = this.formatEventFromStructure(event);
        
        let message = `🗓️ **Data:** ${discordDate}\n`;
        message += `⏰ **Czas do wydarzenia:** ${discordTimestamp}\n\n`;
        message += formattedEvent;
        
        return message;
    }

    /**
     * Formatuje wydarzenie zgodnie ze strukturą HTML strony
     */
    formatEventFromStructure(event) {
        let formatted = '';
        
        // Parsuj sekcje z opisu wydarzenia
        const sections = this.parseEventSections(event.event);
        
        sections.forEach(section => {
            if (section.title && section.content) {
                formatted += `**${section.title}**\n`;
                formatted += `${section.content}\n\n`;
            }
        });
        
        return formatted.trim();
    }

    /**
     * Parsuje sekcje wydarzenia z tekstu - używa bezpośrednio strukturalnej ekstraktacji
     */
    parseEventSections(eventText) {
        // Użyj bezpośrednio strukturalnej ekstraktacji
        const structuredContent = this.extractStructuredContent(eventText);
        
        if (structuredContent) {
            // Parsuj sekcje ze strukturalnej zawartości
            const sections = [];
            const sectionBlocks = structuredContent.split(/\*\*([^*]+)\*\*/);
            
            for (let i = 1; i < sectionBlocks.length; i += 2) {
                const title = sectionBlocks[i].trim();
                const content = sectionBlocks[i + 1] ? sectionBlocks[i + 1].trim() : '';
                
                if (title && content && content.length > 10) {
                    sections.push({
                        title: title,
                        content: content
                    });
                }
            }
            
            return sections;
        }
        
        // Fallback - podstawowy opis
        const cleanContent = this.cleanSectionContent(eventText);
        if (cleanContent.length > 10) {
            return [{
                title: 'Informacje o wydarzeniu',
                content: cleanContent
            }];
        }
        
        return [];
    }

    /**
     * Czyści zawartość sekcji
     */
    cleanSectionContent(content) {
        return content
            .replace(/\b\d{1,2}:\d{2}\b/g, '') // usuń czasy
            .replace(/\(UTC\s*\d*\)/g, '') // usuń UTC
            .replace(/\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g, '') // usuń daty
            .replace(/[-–—]\s*(UTC|Time)/gi, '') // usuń separatory z czasem
            .replace(/^[-–—\s]+/, '') // usuń myślniki na początku
            .replace(/This website has been created to guide players.*?Soon\.\.\./gs, '') // usuń stopkę strony
            .replace(/kaliqq47856@proton\.me/g, '') // usuń email
            .replace(/Privacy Policy/g, '') // usuń politykę prywatności
            .replace(/If you encounter any bugs or errors.*?via email\./gs, '') // usuń informacje o błędach
            .replace(/❤️/g, '') // usuń emoji serca
            .replace(/\s+/g, ' ') // znormalizuj białe znaki
            .replace(/\.\s+/g, '.\n') // nowa linia po każdym zdaniu
            .replace(/\n\s*\n/g, '\n') // usuń podwójne nowe linie
            .trim();
    }

    /**
     * Wyciąga tytuł wydarzenia (pierwszą część przed kropką)
     */
    extractEventTitle(eventText) {
        // Znajdź pierwszy znaczący fragment
        const firstSentence = eventText.split(/[.!]/)[0].trim();
        if (firstSentence.length > 5 && firstSentence.length < 80) {
            return firstSentence;
        }
        
        // Jeśli za długi, weź pierwsze 60 znaków
        return eventText.substring(0, 60).trim() + (eventText.length > 60 ? '...' : '');
    }

    /**
     * Czyści i formatuje opis wydarzenia
     */
    cleanEventDescription(eventText) {
        let description = eventText;
        
        // Usuń informacje o czasie z opisu
        description = description
            .replace(/\b\d{1,2}:\d{2}\b/g, '') // usuń czasy HH:MM
            .replace(/\(UTC\s*\d*\)/g, '') // usuń (UTC 0)
            .replace(/UTC\s*\d*/g, '') // usuń UTC
            .replace(/\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/g, '') // usuń daty
            .replace(/[-–—]\s*(UTC|Time)/gi, '') // usuń separatory z czasem
            .replace(/^[-–—\s]+/, '') // usuń myślniki na początku
            .replace(/\s+/g, ' ') // znormalizuj białe znaki
            .trim();
        
        // Podziel na zdania i dodaj nowe linie
        const sentences = description.split(/([.!?])/);
        let formattedDescription = '';
        
        for (let i = 0; i < sentences.length; i += 2) {
            const sentence = sentences[i];
            const punctuation = sentences[i + 1] || '';
            
            if (sentence && sentence.trim().length > 3) {
                formattedDescription += sentence.trim() + punctuation;
                if (punctuation && i < sentences.length - 2) {
                    formattedDescription += '\n';
                }
            }
        }
        
        // Oczyść końcowy wynik
        formattedDescription = formattedDescription
            .replace(/\n\s*\n/g, '\n') // usuń podwójne nowe linie
            .trim();
            
        return formattedDescription || 'Szczegóły wkrótce...';
    }

    /**
     * Wyciąga strukturalną zawartość ze strony
     */
    extractStructuredContent(content) {
        try {
            let structured = '';
            
            // Wzorce dla sekcji zgodnych ze strukturą strony
            const sectionPatterns = [
                {
                    title: 'Released Collections',
                    pattern: /Released Collections?(.*?)(?=New Collection Sets|Collection Custom Set|Costumes|$)/is
                },
                {
                    title: 'New Collection Sets',  
                    pattern: /New Collection Sets?(.*?)(?=Collection Custom Set|Costumes|Released Collections|$)/is
                },
                {
                    title: 'Collection Custom Set',
                    pattern: /Collection Custom Set(.*?)(?=Costumes|New Collection Sets|Released Collections|$)/is
                },
                {
                    title: 'Universal Exchange Shop',
                    pattern: /Universal Exchange Shop(.*?)(?=Costumes|Collection|$)/is
                },
                {
                    title: 'SS Belt Chaos Fusion',
                    pattern: /SS Belt.*?Chaos Fusion(.*?)(?=Costumes|Collection|$)/is
                },
                {
                    title: 'Amazing Diamond Carnival',
                    pattern: /Amazing Diamond Carnival(.*?)(?=Costumes|Collection|$)/is
                },
                {
                    title: 'Advanced Retreat Privileges',
                    pattern: /Advanced Retreat Privileges(.*?)(?=Costumes|Collection|$)/is
                },
                {
                    title: 'Twinborn Tech',
                    pattern: /Twinborn Tech(.*?)(?=Costumes|Collection|$)/is
                },
                {
                    title: 'Costumes',
                    pattern: /Costumes?(.*?)$/is
                }
            ];
            
            let foundSections = 0;
            
            for (const sectionPattern of sectionPatterns) {
                const match = content.match(sectionPattern.pattern);
                if (match && match[1]) {
                    let sectionContent = match[1]
                        .replace(/^\s*[-–—]*\s*/, '') // usuń myślniki na początku
                        .replace(/\s+/g, ' ')
                        .trim();
                    
                    if (sectionContent.length > 15) {
                        structured += `**${sectionPattern.title}**\n`;
                        structured += `${sectionContent}\n\n`;
                        foundSections++;
                    }
                }
            }
            
            // Jeśli znaleziono co najmniej jedną sekcję, zwróć strukturę
            if (foundSections > 0) {
                return structured.trim();
            }
            
            return null;
        } catch (error) {
            return null;
        }
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
     * Publikuje lub aktualizuje wiadomości na kanale (jedna wiadomość na wydarzenie)
     */
    async publishOrUpdateMessages() {
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

            // Wyślij nagłówek timeline jeśli nie ma żadnych wiadomości
            if (this.messageIds.length === 0 && this.timelineData.length > 0) {
                const headerMessage = `# 🎯 **TIMELINE WYDARZEŃ** 🎯\n\n*Aktualizacje automatyczne co godzinę*\n*Last Update: <t:${Math.floor(Date.now()/1000)}:F>*\n`;
                const headerMsg = await channel.send(headerMessage);
                this.logger.info(`Utworzono nagłówek timeline (ID: ${headerMsg.id})`);
            }

            // Usuń stare wiadomości jeśli liczba wydarzeń się zmieniła
            if (this.messageIds.length > this.timelineData.length) {
                const messagesToDelete = this.messageIds.slice(this.timelineData.length);
                for (const msgId of messagesToDelete) {
                    try {
                        const oldMessage = await channel.messages.fetch(msgId);
                        await oldMessage.delete();
                        this.logger.info(`Usunięto starą wiadomość wydarzenia (ID: ${msgId})`);
                    } catch (error) {
                        this.logger.warn(`Nie można usunąć starej wiadomości ${msgId}: ${error.message}`);
                    }
                }
                this.messageIds = this.messageIds.slice(0, this.timelineData.length);
            }

            // Sortuj wydarzenia od najstarszego do najnowszego
            const sortedEvents = [...this.timelineData].sort((a, b) => {
                const dateA = this.parseEventDateTime(a.date, a.time);
                const dateB = this.parseEventDateTime(b.date, b.time);
                return dateA - dateB;
            });

            // Filtruj wydarzenia - usuń te starsze niż 7 dni
            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
            
            const activeEvents = sortedEvents.filter(event => {
                const eventDate = this.parseEventDateTime(event.date, event.time);
                return eventDate >= sevenDaysAgo;
            });

            const removedCount = sortedEvents.length - activeEvents.length;
            if (removedCount > 0) {
                this.logger.info(`Usunięto ${removedCount} przestarzałych wydarzeń (starszych niż 7 dni)`);
            }

            this.logger.info(`Posortowano ${activeEvents.length} aktywnych wydarzeń chronologicznie`);

            // Usuń wiadomości dla przestarzałych wydarzeń
            const eventsToRemove = this.messageIds.length - activeEvents.length;
            if (eventsToRemove > 0) {
                const messagesToDelete = this.messageIds.slice(activeEvents.length);
                for (const msgId of messagesToDelete) {
                    try {
                        const oldMessage = await channel.messages.fetch(msgId);
                        await oldMessage.delete();
                        this.logger.info(`Usunięto przestarzałą wiadomość wydarzenia (ID: ${msgId})`);
                    } catch (error) {
                        this.logger.warn(`Nie można usunąć przestarzałej wiadomości ${msgId}: ${error.message}`);
                    }
                }
                // Skróć tablicę ID wiadomości
                this.messageIds = this.messageIds.slice(0, activeEvents.length);
            }

            // Aktualizuj lub utwórz wiadomości dla każdego aktywnego wydarzenia
            for (let i = 0; i < activeEvents.length; i++) {
                const event = activeEvents[i];
                const messageContent = this.generateEventMessage(event);
                
                if (this.messageIds[i]) {
                    // Zaktualizuj istniejącą wiadomość
                    try {
                        const existingMessage = await channel.messages.fetch(this.messageIds[i]);
                        await existingMessage.edit(messageContent);
                        this.logger.info(`✅ Zaktualizowano wydarzenie ${i + 1}: ${event.event.substring(0, 30)}...`);
                    } catch (error) {
                        this.logger.warn(`⚠️ Nie można zaktualizować wiadomości ${this.messageIds[i]}, tworzę nową`);
                        const newMessage = await channel.send(messageContent);
                        this.messageIds[i] = newMessage.id;
                        this.logger.info(`Utworzono nową wiadomość dla wydarzenia ${i + 1} (ID: ${newMessage.id})`);
                    }
                } else {
                    // Utwórz nową wiadomość
                    const newMessage = await channel.send(messageContent);
                    this.messageIds[i] = newMessage.id;
                    this.logger.info(`Utworzono nową wiadomość dla wydarzenia ${i + 1} (ID: ${newMessage.id})`);
                }
                
                // Krótka przerwa między wysyłaniem wiadomości (rate limiting)
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Zapisz zaktualizowane ID wiadomości
            await this.saveTimelineData();
            this.logger.info(`✅ Zaktualizowano wszystkie ${activeEvents.length} aktywnych wydarzeń`);
            
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