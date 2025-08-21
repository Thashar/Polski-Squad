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
            const rawHTML = await WebFetch.fetchRawHTML('https://garrytools.com/timeline');
            
            // Parsuj odpowiedź z HTML
            const events = this.parseTimelineFromHTML(response, rawHTML);
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
    parseTimelineFromHTML(htmlText, rawHTML = '') {
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
                    
                    // Znajdź początek tego wydarzenia
                    const eventStart = tableContent.indexOf(date);
                    
                    // Znajdź koniec tego wydarzenia - szukaj następnej pełnej daty z czasem
                    const nextEventPattern = /\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\s+\d{1,2}:\d{2}/g;
                    let nextEventIndex = -1;
                    
                    // Szukaj od pozycji po aktualnej dacie
                    const searchText = tableContent.substring(eventStart + date.length);
                    const nextEventMatch = searchText.match(nextEventPattern);
                    
                    if (nextEventMatch) {
                        // Znajdź pozycję pierwszego następnego wydarzenia
                        nextEventIndex = searchText.indexOf(nextEventMatch[0]);
                        if (nextEventIndex > 50) { // Minimum 50 znaków dla wydarzenia
                            nextEventIndex = eventStart + date.length + nextEventIndex;
                        } else {
                            nextEventIndex = -1;
                        }
                    }
                    
                    // Wyciągnij sekcję tylko tego wydarzenia
                    let extendedSection;
                    if (nextEventIndex > eventStart) {
                        extendedSection = tableContent.substring(eventStart, nextEventIndex);
                    } else {
                        // Jeśli to ostatnie wydarzenie, weź do końca lub maksymalnie 1500 znaków
                        extendedSection = tableContent.substring(eventStart, eventStart + 1500);
                    }
                    
                    // Zachowaj oryginalną strukturę z sekcjami i konwertuj HTML na Discord markdown
                    let rawEventContent = extendedSection
                        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // usuń skrypty
                        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // usuń style
                        .replace(/<img[^>]*>/gi, '') // usuń obrazki
                        // Konwertuj HTML na Discord markdown
                        .replace(/<h[1-6][^>]*class\s*=\s*["'][^"']*text-muted[^"']*["'][^>]*>(.*?)<\/h[1-6]>/gi, '**$1**') // h1-h6 z klasą text-muted na pogrubienie
                        .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '**$1**') // wszystkie nagłówki na pogrubienie
                        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**') // strong na pogrubienie
                        .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**') // b na pogrubienie
                        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*') // em na kursywę
                        .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*') // i na kursywę
                        .replace(/<br\s*\/?>/gi, '\n') // br na nową linię
                        .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n') // kolejne paragrafy oddziel podwójną linią
                        .replace(/<p[^>]*>/gi, '') // usuń otwierające tagi p
                        .replace(/<\/p>/gi, '\n') // zamykające tagi p na nową linię
                        .replace(/<[^>]*>/g, ' ') // usuń pozostałe tagi HTML
                        .replace(/This website has been created to guide players.*?Soon\.\.\./gs, '') // usuń stopkę strony
                        .replace(/kaliqq47856@proton\.me/g, '') // usuń email
                        .replace(/Privacy Policy/g, '') // usuń politykę prywatności
                        .replace(/❤️/g, '') // usuń serce ze stopki
                        .replace(/[ \t]+/g, ' ') // znormalizuj spacje i taby (ale zachowaj nowe linie)
                        .replace(/ *\n */g, '\n') // popraw formatowanie nowych linii
                        .replace(/\n\n\n+/g, '\n\n') // maksymalnie podwójne nowe linie
                        .trim();
                    
                    // Normalizuj format daty
                    let normalizedDate = date.trim();
                    
                    // Znajdź i zachowaj strukturę sekcji
                    const structuredContent = this.extractStructuredContent(rawEventContent, rawHTML, normalizedDate);
                    let eventDescription = structuredContent || rawEventContent.substring(0, 500).trim();
                    
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
                            event: eventDescription,
                            rawHTML: rawHTML // przechowaj rawHTML dla parsera
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
        
        // Wygeneruj ciekawy nagłówek na podstawie treści wydarzenia
        const eventTitle = this.generateEventTitle(event);
        
        let message = `# 📅 Aktualizacja - ${discordDate}\n\n`;
        message += `⏰ **Czas do wydarzenia:** ${discordTimestamp}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        message += formattedEvent;
        message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        
        return message;
    }


    /**
     * Generuje uniwersalny tytuł wydarzenia na podstawie daty
     */
    generateEventTitle(event) {
        const dateParts = event.date.split(' ');
        const day = dateParts[0];
        const month = dateParts[1];
        const year = dateParts[2];
        
        // Mapuj nazwy miesięcy na polskie
        const monthMap = {
            'January': 'Styczeń', 'February': 'Luty', 'March': 'Marzec',
            'April': 'Kwiecień', 'May': 'Maj', 'June': 'Czerwiec',
            'July': 'Lipiec', 'August': 'Sierpień', 'September': 'Wrzesień',
            'October': 'Październik', 'November': 'Listopad', 'December': 'Grudzień'
        };
        
        const polishMonth = monthMap[month] || month;
        
        return `${day} ${polishMonth} ${year}`;
    }

    /**
     * Formatuje wydarzenie zgodnie ze strukturą HTML strony
     */
    formatEventFromStructure(event) {
        let formatted = '';
        
        // Parsuj sekcje z opisu wydarzenia
        const sections = this.parseEventSections(event.event, event.rawHTML, event.date);
        
        sections.forEach((section, index) => {
            this.logger.info(`🔍 DEBUG: Sekcja ${index}: title="${section.title}", content="${section.content ? section.content.substring(0, 50) + '...' : 'brak'}"`);
            
            if (section.title && section.content && section.content.length > 10) {
                const trimmedTitle = section.title.trim();
                
                // Pomiń sekcje które są tylko emoji (bez tekstu)
                const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(trimmedTitle);
                if (isOnlyEmoji) {
                    return; // pomiń tę sekcję
                }
                
                // Sprawdź czy tytuł już zawiera emoji na początku (rozszerzone sprawdzanie)
                const hasEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/u.test(trimmedTitle);
                
                if (hasEmoji) {
                    // Jeśli tytuł już ma emoji, użyj go bez dodawania nowego
                    formatted += `**${trimmedTitle}**\n`;
                } else {
                    // Jeśli nie ma emoji, dodaj odpowiednie
                    const sectionEmoji = this.getSectionEmoji(trimmedTitle);
                    formatted += `${sectionEmoji} **${trimmedTitle}**\n`;
                }
                formatted += `${section.content}\n`;
            }
        });
        
        return formatted.trim();
    }

    /**
     * Zwraca emoji dla sekcji
     */
    getSectionEmoji(sectionTitle) {
        const title = sectionTitle.toLowerCase();
        
        if (title.includes('collections') || title.includes('collection')) {
            return '📦';
        } else if (title.includes('custom set')) {
            return '⚡';
        } else if (title.includes('universal exchange')) {
            return '🏪';
        } else if (title.includes('chaos fusion')) {
            return '⚔️';
        } else if (title.includes('diamond carnival')) {
            return '💎';
        } else if (title.includes('retreat privileges')) {
            return '🎯';
        } else if (title.includes('twinborn')) {
            return '⚡';
        } else if (title.includes('costumes')) {
            return '👗';
        } else {
            return '🎮';
        }
    }

    /**
     * Parsuje sekcje wydarzenia z tekstu - używa bezpośrednio strukturalnej ekstraktacji
     */
    parseEventSections(eventText, rawHTML = '', eventDate = '') {
        // Jeśli eventText już zawiera strukturę Discord markdown (z **), to go używaj bezpośrednio
        if (eventText.includes('**') && eventText.includes('\n')) {
            // Parsuj sekcje ze strukturalnej zawartości
            const sections = [];
            const sectionBlocks = eventText.split(/\*\*([^*]+)\*\*/);
            
            for (let i = 1; i < sectionBlocks.length; i += 2) {
                const title = sectionBlocks[i].trim();
                const content = sectionBlocks[i + 1] ? sectionBlocks[i + 1].trim() : '';
                
                // Filtruj pojedyncze emoji jako tytuły sekcji
                const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(title);
                
                if (title && content && content.length > 10 && !isOnlyEmoji) {
                    sections.push({
                        title: title,
                        content: content
                    });
                }
            }
            
            return sections;
        }
        
        // Jeśli nie ma struktury, użyj ekstraktacji HTML
        const structuredContent = this.extractStructuredContent(eventText, rawHTML, eventDate);
        
        if (structuredContent) {
            // Debug: sprawdź zawartość przed parsowaniem
            if (this.logger && this.config?.ocr?.detailedLogging?.enabled) {
                this.logger.info('StructuredContent przed parsowaniem:', structuredContent);
            }
            
            // Parsuj sekcje ze strukturalnej zawartości
            const sections = [];
            const sectionBlocks = structuredContent.split(/\*\*([^*]+)\*\*/);
            
            if (this.logger && this.config?.ocr?.detailedLogging?.enabled) {
                this.logger.info('SectionBlocks po split:', sectionBlocks);
            }
            
            for (let i = 1; i < sectionBlocks.length; i += 2) {
                const title = sectionBlocks[i].trim();
                const content = sectionBlocks[i + 1] ? sectionBlocks[i + 1].trim() : '';
                
                if (this.logger && this.config?.ocr?.detailedLogging?.enabled) {
                    this.logger.info(`Sekcja ${i}: title="${title}", content="${content.substring(0,50)}..."`);
                }
                
                // Filtruj pojedyncze emoji jako tytuły sekcji
                const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(title);
                
                if (title && content && content.length > 10 && !isOnlyEmoji) {
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
            .replace(/This website has been created to guide players.*?(?:Soon\.\.\.)?.*?(?:❤️)?.*?(?:If you encounter any bugs or errors.*?)?$/gs, '') // usuń całą stopkę
            .replace(/kaliqq47856@proton\.me/g, '') // usuń email
            .replace(/Privacy Policy/g, '') // usuń politykę prywatności  
            .replace(/enhance their gaming experience\./g, '') // usuń fragment stopki
            .replace(/❤️/g, '') // usuń emoji serca
            .replace(/\s+/g, ' ') // znormalizuj białe znaki
            .replace(/\.\s+(?=[A-Z])/g, '.\n\n')  // nowa linia po kropce tylko przed kolejnym zdaniem z dużą literą
            .replace(/The package rates are as follows;\s*/g, 'The package rates are as follows:\n\n')  // specjalna obsługa dla pakietów
            .replace(/Free:\s*([0-9.,]+\s+Gems)\s*/g, '• **Free:** $1\n')  // format listy dla Free
            .replace(/\$(\d+)\s+Pack:\s*([0-9.,]+\s+Gems)/g, '• **$$$1 Pack:** $2\n')  // format listy dla płatnych pakietów
            .replace(/Collections?\s*$/i, '\n**Collections**')  // osobna sekcja dla Collections
            .replace(/\n\s*\n\s*\n+/g, '\n\n') // usuń nadmiarowe puste linie (max 2)
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
     * Wyciąga obrazki związane z wydarzeniem
     */
    extractEventImages(rawHTML, eventSection, eventDescription) {
        try {
            const images = [];
            
            // Znajdź wszystkie tagi img w sekcji wydarzenia
            const imgRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
            let match;
            
            // Przeszukaj sekcję wydarzenia w raw HTML
            while ((match = imgRegex.exec(eventSection)) !== null) {
                let imgUrl = match[1];
                
                // Przekonwertuj relatywne URL na absolutne
                if (imgUrl.startsWith('/')) {
                    imgUrl = 'https://garrytools.com' + imgUrl;
                } else if (imgUrl.startsWith('public/')) {
                    imgUrl = 'https://garrytools.com/' + imgUrl;
                }
                
                // Filtruj niepotrzebne obrazki (light/dark mode, ikony nawigacji)
                if (!this.shouldSkipImage(imgUrl)) {
                    images.push(imgUrl);
                }
            }
            
            // Jeśli nie znaleziono obrazków w sekcji, spróbuj z całego HTML
            if (images.length === 0) {
                // Szukaj specjalnych obrazków związanych z tekstem wydarzenia
                const eventKeywords = this.extractImageKeywords(eventDescription);
                
                for (const keyword of eventKeywords) {
                    const keywordImages = this.findImagesByKeyword(rawHTML, keyword);
                    images.push(...keywordImages);
                }
            }
            
            // Usuń duplikaty i ogranicz do maksymalnie 30 obrazków
            const uniqueImages = [...new Set(images)].slice(0, 30);
            
            this.logger.info(`Znaleziono ${uniqueImages.length} obrazków dla wydarzenia`);
            return uniqueImages;
            
        } catch (error) {
            this.logger.error('Błąd wyciągania obrazków:', error);
            return [];
        }
    }

    /**
     * Sprawdza czy obrazek powinien zostać pominięty
     */
    shouldSkipImage(imgUrl) {
        const skipPatterns = [
            'light.svg',
            'dark.svg',
            'favicon',
            'logo',
            'nav',
            'menu'
        ];
        
        return skipPatterns.some(pattern => imgUrl.toLowerCase().includes(pattern));
    }

    /**
     * Wyciąga słowa kluczowe z opisu wydarzenia do wyszukiwania obrazków
     */
    extractImageKeywords(eventDescription) {
        const keywords = [];
        
        // Szukaj specjalnych słów kluczowych
        const keywordPatterns = [
            /collection/i,
            /diamond.*carnival/i,
            /gems/i,
            /pack/i,
            /costume/i,
            /exchange.*shop/i,
            /chaos.*fusion/i,
            /retreat.*privileges/i,
            /twinborn.*tech/i
        ];
        
        for (const pattern of keywordPatterns) {
            if (pattern.test(eventDescription)) {
                keywords.push(pattern.source.toLowerCase().replace(/[^a-z]/g, ''));
            }
        }
        
        return keywords;
    }

    /**
     * Znajdź obrazki według słów kluczowych
     */
    findImagesByKeyword(rawHTML, keyword) {
        const images = [];
        const imgRegex = /<img[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
        let match;
        
        while ((match = imgRegex.exec(rawHTML)) !== null) {
            let imgUrl = match[1];
            
            // Przekonwertuj relatywne URL na absolutne
            if (imgUrl.startsWith('/')) {
                imgUrl = 'https://garrytools.com' + imgUrl;
            } else if (imgUrl.startsWith('public/')) {
                imgUrl = 'https://garrytools.com/' + imgUrl;
            }
            
            // Sprawdź czy URL zawiera słowo kluczowe
            if (imgUrl.toLowerCase().includes(keyword) && !this.shouldSkipImage(imgUrl)) {
                images.push(imgUrl);
            }
        }
        
        return images.slice(0, 10); // Maksymalnie 10 obrazków na słowo kluczowe
    }

    /**
     * Parsuje HTML card-body na Discord markdown
     */
    parseEventCardBody(rawHTML, eventDate) {
        try {
            this.logger.info(`🔍 DEBUG: parseEventCardBody - szukam daty: "${eventDate}"`);
            // Szukaj w kontekście daty wydarzenia
            const dateIndex = rawHTML.indexOf(eventDate);
            if (dateIndex === -1) {
                this.logger.warn(`🔍 DEBUG: Nie znaleziono daty w rawHTML`);
                return null;
            }
            
            // Weź sekcję wokół daty (20000 znaków po dacie)
            const dateSection = rawHTML.substring(dateIndex, dateIndex + 20000);
            
            // Znajdź card-body - prostszy pattern
            const cardBodyStart = dateSection.indexOf('<div class="card-body">');
            if (cardBodyStart === -1) {
                this.logger.warn(`🔍 DEBUG: Nie znaleziono <div class="card-body"> w sekcji daty`);
                return null;
            }
            this.logger.info(`🔍 DEBUG: Znaleziono card-body na pozycji ${cardBodyStart}`);
            
            // Weź większy kawałek - do 15000 znaków od card-body
            const cardBodyContent = dateSection.substring(cardBodyStart + 23, cardBodyStart + 15000);
            const cardBody = cardBodyContent;
            let discordContent = '';
            
            // Najpierw sprawdź czy są tabele
            const tableMatches = cardBody.match(/<table[^>]*>(.*?)<\/table>/gs);
            if (tableMatches && tableMatches.length > 0) {
                this.logger.info(`Znaleziono ${tableMatches.length} tabel`);
                
                for (const tableMatch of tableMatches) {
                    // Znajdź tytuł tabeli z th colspan
                    const titleMatch = tableMatch.match(/<th\s+colspan\s*=\s*["']\d+["'][^>]*class\s*=\s*["'][^"']*text-center[^"']*["'][^>]*>(.*?)<\/th>/);
                    if (titleMatch) {
                        const tableTitle = titleMatch[1].trim();
                        this.logger.info(`🔍 DEBUG: Znaleziono tytuł tabeli: "${tableTitle}"`);
                        
                        // Sprawdź czy tytuł nie składa się tylko z emoji
                        const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(tableTitle);
                        this.logger.info(`🔍 DEBUG: Czy tylko emoji: ${isOnlyEmoji}`);
                        
                        if (!isOnlyEmoji) {
                            const sectionEmoji = this.getSectionEmoji(tableTitle);
                            this.logger.info(`🔍 DEBUG: Dodaję sekcję tabeli: "${sectionEmoji} **${tableTitle}**"`);
                            discordContent += `${sectionEmoji} **${tableTitle}**\n`;
                        } else {
                            this.logger.info(`🔍 DEBUG: Pomijam tytuł tabeli składający się tylko z emoji`);
                        }
                    }
                    
                    // Znajdź wszystkie wiersze tbody
                    const rowMatches = tableMatch.match(/<tr[^>]*>(?!.*<th).*?<\/tr>/gs);
                    if (rowMatches) {
                        for (const rowMatch of rowMatches) {
                            const cellMatches = rowMatch.match(/<td[^>]*>(.*?)<\/td>/gs);
                            if (cellMatches && cellMatches.length >= 2) {
                                const number = cellMatches[0].replace(/<td[^>]*>(.*?)<\/td>/, '$1').trim();
                                const content = cellMatches[1].replace(/<td[^>]*>(.*?)<\/td>/, '$1').trim();
                                
                                if (number && content) {
                                    discordContent += `${number}. ${content}\n`;
                                }
                            }
                        }
                    }
                    
                    discordContent += '\n';
                }
            }
            
            // Następnie sprawdź sekcje div - uproszczony parser
            const sectionStart = cardBody.indexOf('<div class="section');
            this.logger.info(`🔍 DEBUG: Szukam <div class="section"> - znaleziono na pozycji: ${sectionStart}`);
            if (sectionStart !== -1) {
                // Wyciągnij całą sekcję div
                const sectionEnd = cardBody.indexOf('</div>', sectionStart);
                const sectionContent = cardBody.substring(sectionStart, sectionEnd);
                
                this.logger.info(`🔍 DEBUG: Znaleziono sekcję, parsuję h6+p pary`);
                
                // Znajdź wszystkie h6 i odpowiadające im p
                const h6Matches = sectionContent.match(/<h6[^>]*class\s*=\s*["'][^"']*text-muted[^"']*["'][^>]*>(.*?)<\/h6>/g);
                const pMatches = sectionContent.match(/<p[^>]*class\s*=\s*["'][^"']*text-muted[^"']*["'][^>]*>(.*?)<\/p>/gs);
                
                if (h6Matches && pMatches) {
                    this.logger.info(`🔍 DEBUG: Znaleziono ${h6Matches.length} h6 i ${pMatches.length} p`);
                    
                    for (let i = 0; i < h6Matches.length; i++) {
                        const h6Title = h6Matches[i].replace(/<h6[^>]*>(.*?)<\/h6>/, '$1').trim();
                        const pContent = pMatches[i] ? pMatches[i].replace(/<p[^>]*>(.*?)<\/p>/s, '$1')
                            .replace(/<br\s*\/?>/gi, '\n')
                            .replace(/<[^>]*>/g, '')
                            .trim() : '';
                        
                        this.logger.info(`🔍 DEBUG: Para ${i}: h6="${h6Title}", p="${pContent.substring(0, 50)}..."`);
                        
                        // Sprawdź czy tytuł nie składa się tylko z emoji
                        const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(h6Title);
                        
                        if (!isOnlyEmoji && pContent.length > 0) {
                            // Dodaj emoji na podstawie tytułu
                            const sectionEmoji = this.getSectionEmoji(h6Title);
                            this.logger.info(`🔍 DEBUG: Dodaję sekcję: "${sectionEmoji} **${h6Title}**"`);
                            discordContent += `${sectionEmoji} **${h6Title}**\n`;
                            discordContent += `${pContent}\n\n`;
                        } else if (isOnlyEmoji) {
                            this.logger.info(`🔍 DEBUG: Pomijam h6 składający się tylko z emoji: "${h6Title}"`);
                        }
                    }
                }
            }
            
            // Jeśli nie ma ani tabel ani sekcji, spróbuj fallback
            if ((!tableMatches || tableMatches.length === 0) && sectionStart === -1) {
                this.logger.warn('Nie znaleziono sekcji div, próbuję bezpośrednio H6+P');
                
                // Fallback - wyciągnij wszystkie h6 i p bezpośrednio
                const h6Matches = cardBody.match(/<h6[^>]*class\s*=\s*["'][^"']*text-muted[^"']*["'][^>]*>(.*?)<\/h6>/g);
                const pMatches = cardBody.match(/<p[^>]*class\s*=\s*["'][^"']*text-muted[^"']*["'][^>]*>(.*?)<\/p>/gs);
                
                if (h6Matches) {
                    h6Matches.forEach((h6, index) => {
                        const title = h6.replace(/<h6[^>]*>(.*?)<\/h6>/, '$1').trim();
                        this.logger.info(`🔍 DEBUG: Fallback h6 tytuł: "${title}"`);
                        
                        // Sprawdź czy tytuł nie składa się tylko z emoji
                        const isOnlyEmoji = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\s]*$/u.test(title);
                        this.logger.info(`🔍 DEBUG: Czy tylko emoji: ${isOnlyEmoji}`);
                        
                        if (!isOnlyEmoji) {
                            this.logger.info(`🔍 DEBUG: Dodaję fallback sekcję: "**${title}**"`);
                            discordContent += `**${title}**\n`;
                        } else {
                            this.logger.info(`🔍 DEBUG: Pomijam fallback tytuł składający się tylko z emoji`);
                            return; // pomiń tę sekcję całkowicie
                        }
                        
                        // Jeśli jest odpowiadający paragraf
                        if (pMatches && pMatches[index]) {
                            const pContent = pMatches[index].replace(/<p[^>]*>(.*?)<\/p>/s, '$1')
                                .replace(/<br\s*\/?>/gi, '\n')
                                .replace(/<[^>]*>/g, '')
                                .trim();
                            
                            if (pContent.length > 0) {
                                discordContent += `${pContent}\n`;
                            }
                        }
                        
                        discordContent += '\n';
                    });
                }
            }
            
            return discordContent.trim();
            
        } catch (error) {
            this.logger.error('Błąd parsowania card-body:', error);
            return null;
        }
    }

    /**
     * Wyciąga strukturalną zawartość ze strony - używa nowego parsera HTML
     */
    extractStructuredContent(content, rawHTML = '', eventDate = '') {
        // Najpierw spróbuj nowy parser HTML
        if (rawHTML && eventDate) {
            const htmlParsed = this.parseEventCardBody(rawHTML, eventDate);
            if (htmlParsed) {
                return htmlParsed;
            }
        }
        
        // Fallback do starego parsera
        try {
            let structured = '';
            
            // Wzorce dla sekcji zgodnych ze strukturą strony - ulepszony parsing
            const sectionPatterns = [
                {
                    title: 'Collections',
                    patterns: [
                        /Collections?\s*(.*?)(?=New Collection Sets|Collection Custom Set|Universal Exchange Shop|SS Belt|Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is,
                        /Released Collections?\s*(.*?)(?=New Collection Sets|Collection Custom Set|Universal Exchange Shop|SS Belt|Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'New Collection Sets',
                    patterns: [
                        /New Collection Sets?\s*(.*?)(?=Collection Custom Set|Universal Exchange Shop|SS Belt|Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Collection Custom Set',
                    patterns: [
                        /Collection Custom Set\s*(.*?)(?=Universal Exchange Shop|SS Belt|Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Universal Exchange Shop',
                    patterns: [
                        /Universal Exchange Shop\s*(.*?)(?=SS Belt|Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'SS Belt Chaos Fusion',
                    patterns: [
                        /SS Belt.*?Chaos Fusion\s*(.*?)(?=Amazing Diamond|Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Amazing Diamond Carnival',
                    patterns: [
                        /Amazing Diamond Carnival\s*(.*?)(?=Advanced Retreat|Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Advanced Retreat Privileges',
                    patterns: [
                        /Advanced Retreat Privileges\s*(.*?)(?=Twinborn Tech|Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Twinborn Tech',
                    patterns: [
                        /Twinborn Tech[^(]*\([^)]*\)\s*(.*?)(?=Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is,
                        /Twinborn Tech\s*(.*?)(?=Costumes|\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                },
                {
                    title: 'Costumes',
                    patterns: [
                        /Costumes?\s*(.*?)(?=\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|$)/is
                    ]
                }
            ];
            
            let foundSections = 0;
            
            for (const sectionPattern of sectionPatterns) {
                let bestMatch = null;
                let bestContent = '';
                
                // Spróbuj wszystkie wzorce dla tej sekcji
                for (const pattern of sectionPattern.patterns) {
                    const match = content.match(pattern);
                    if (match && match[1] && match[1].trim().length > bestContent.length) {
                        bestMatch = match;
                        bestContent = match[1].trim();
                    }
                }
                
                if (bestMatch && bestContent) {
                    let sectionContent = bestContent
                        .replace(/^\s*[-–—]*\s*/, '') // usuń myślniki na początku
                        .replace(/\s+/g, ' ')
                        .replace(/\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}.*$/g, '') // usuń następną datę i dalej
                        .replace(/This website has been created to guide players.*$/gs, '') // usuń stopkę
                        .replace(/❤️.*$/gs, '') // usuń od emoji serca do końca
                        .replace(/If you encounter any bugs or errors.*$/gs, '') // usuń informacje o błędach
                        .trim();
                    
                    if (sectionContent.length > 15) {
                        // Inteligentne formatowanie - zachowaj logiczne grupowanie
                        sectionContent = sectionContent
                            .replace(/\.\s+(?=[A-Z])/g, '.\n\n')  // nowa linia po kropce tylko przed kolejnym zdaniem z dużą literą
                            .replace(/The package rates are as follows;\s*/g, 'The package rates are as follows:\n\n')  // specjalna obsługa dla pakietów
                            .replace(/Free:\s*([0-9.,]+\s+Gems)\s*/g, '• **Free:** $1\n')  // format listy dla Free
                            .replace(/\$(\d+)\s+Pack:\s*([0-9.,]+\s+Gems)/g, '• **$$$1 Pack:** $2\n')  // format listy dla płatnych pakietów
                            .replace(/Collections?\s*$/i, '\n**Collections**')  // osobna sekcja dla Collections
                            .replace(/\n\s*\n\s*\n+/g, '\n\n')  // usuń nadmiarowe puste linie (max 2)
                            .replace(/^\s+|\s+$/g, '')  // usuń spacje na początku i końcu
                            .trim();
                        
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

            // Filtruj wydarzenia - usuń te które już się zakończyły (przeterminowane)
            const now = new Date();
            
            const activeEvents = sortedEvents.filter(event => {
                const eventDate = this.parseEventDateTime(event.date, event.time);
                return eventDate >= now;
            });

            const removedCount = sortedEvents.length - activeEvents.length;
            if (removedCount > 0) {
                this.logger.info(`Usunięto ${removedCount} przeterminowanych wydarzeń`);
            }

            this.logger.info(`Posortowano ${activeEvents.length} aktywnych wydarzeń chronologicznie`);

            // Usuń wiadomości dla przeterminowanych wydarzeń
            const eventsToRemove = this.messageIds.length - activeEvents.length;
            if (eventsToRemove > 0) {
                const messagesToDelete = this.messageIds.slice(activeEvents.length);
                for (const msgId of messagesToDelete) {
                    try {
                        const oldMessage = await channel.messages.fetch(msgId);
                        await oldMessage.delete();
                        this.logger.info(`Usunięto przeterminowaną wiadomość wydarzenia (ID: ${msgId})`);
                    } catch (error) {
                        this.logger.warn(`Nie można usunąć przeterminowanej wiadomości ${msgId}: ${error.message}`);
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
            this.logger.error('❌ Błąd publikowania/aktualizacji wiadomości timeline:', error.message);
            this.logger.error('❌ Stack trace:', error.stack);
            this.logger.error('❌ Szczegóły błędu:', {
                name: error.name,
                message: error.message,
                code: error.code,
                status: error.status,
                requestData: error.requestData
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