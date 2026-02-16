const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { calculateNameSimilarity } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const { saveProcessedImage, cleanupOrphanedTempFiles } = require('../../utils/ocrFileUtils');
const { EmbedBuilder } = require('discord.js');
const { stopGhostPing } = require('../handlers/interactionHandlers');
const AIOCRService = require('./aiOcrService');

const logger = createBotLogger('StalkerLME');

class OCRService {
    constructor(config, client = null) {
        this.config = config;
        this.client = client;
        this.tempDir = this.config.ocr.tempDir || './StalkerLME/temp';
        this.processedDir = this.config.ocr.processedDir || './StalkerLME/processed';

        // Inicjalizuj AI OCR Service (opcjonalny)
        this.aiOcrService = new AIOCRService(config);

        // System kolejkowania OCR - wspólny dla wszystkich komend używających OCR
        this.activeProcessing = new Map(); // guildId → {userId, commandName, expiresAt, timeout}
        this.waitingQueue = new Map(); // guildId → [{userId, addedAt, commandName}]
        this.queueReservation = new Map(); // guildId → {userId, expiresAt, timeout, commandName}

        // Wyświetlanie kolejki
        this.queueMessageId = null; // ID wiadomości z embdem kolejki
        this.queueChannelId = this.config.queueChannelId;

        // Referencje do innych serwisów (ustawiane później przez setServices)
        this.reminderService = null;
        this.punishmentService = null;
    }

    /**
     * Ustaw klienta (wywoływane z index.js po inicjalizacji)
     */
    setClient(client) {
        this.client = client;
    }

    /**
     * Ustaw referencje do innych serwisów (wywoływane z index.js po inicjalizacji wszystkich serwisów)
     */
    setServices(reminderService, punishmentService, phaseService) {
        this.reminderService = reminderService;
        this.punishmentService = punishmentService;
        this.phaseService = phaseService;
    }

    async initializeOCR() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            if (this.config.ocr.saveProcessedImages) {
                await fs.mkdir(this.processedDir, { recursive: true });
            }

            // Wyczyść osierocone pliki temp z poprzedniej sesji
            const cleaned = await cleanupOrphanedTempFiles(this.processedDir, 0, logger);
            if (cleaned > 0) {
                logger.info(`[OCR] 🧹 Wyczyszczono ${cleaned} osieroconych plików temp z poprzedniej sesji`);
            }

            logger.info('[OCR] ✅ Serwis OCR zainicjalizowany');
        } catch (error) {
            logger.error('[OCR] ❌ Błąd inicjalizacji OCR:', error);
        }
    }

    async processImage(attachment) {
        let buffer = null;
        let processedBuffer = null;

        try {
            logger.info('Rozpoczęcie analizy OCR');
            logger.info(`📷 Przetwarzanie obrazu: ${attachment.url}`);

            const response = await fetch(attachment.url);
            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);

            processedBuffer = await this.processImageWithSharp(buffer);

            logger.info('Uruchamianie OCR');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                tessedit_char_whitelist: this.config.ocr.polishAlphabet
            });

            logger.info('🔤 Odczytany tekst z OCR:');
            const textLines = text.split('\n').filter(line => line.trim().length > 0);
            textLines.forEach((line, index) => {
                logger.info(`${index + 1}: ${line.trim()}`);
            });

            // Zwolnij pamięć
            buffer = null;
            processedBuffer = null;

            return text;
        } catch (error) {
            logger.error('Błąd OCR');
            logger.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        } finally {
            // Wymuś zwolnienie bufora z pamięci
            buffer = null;
            processedBuffer = null;
        }
    }

    /**
     * Przetwarza obraz z pliku lokalnego (dla Phase 1)
     * Wspiera AI OCR z fallbackiem na tradycyjny Tesseract
     */
    async processImageFromFile(filepath) {
        let imageBuffer = null;
        let processedBuffer = null;

        try {
            logger.info(`[OCR] 📂 Przetwarzanie pliku: ${filepath}`);

            // === KROK 1: Spróbuj AI OCR jeśli włączony ===
            if (this.config.ocr.useAI && this.aiOcrService.enabled) {
                logger.info('[AI OCR] 🤖 Próba analizy przez Claude Vision...');

                try {
                    const aiResult = await this.aiOcrService.analyzeResultsImage(filepath);

                    if (aiResult.isValid && aiResult.players.length > 0) {
                        logger.info(`[AI OCR] ✅ Pomyślnie rozpoznano ${aiResult.players.length} graczy`);

                        // Przekonwertuj wyniki AI na format tekstowy (każda linia: "nick - wynik")
                        const textLines = aiResult.players.map(p => `${p.playerName} - ${p.score}`);
                        const text = textLines.join('\n');

                        logger.info('[AI OCR] 🔤 Sparsowane dane z AI:');
                        textLines.forEach((line, index) => {
                            logger.info(`${index + 1}: ${line}`);
                        });

                        return text;
                    } else {
                        logger.warn('[AI OCR] ⚠️ AI OCR nie znalazł graczy lub wykrył niepoprawny screen');
                        logger.warn('[AI OCR] 🔄 Fallback na tradycyjny OCR...');
                    }
                } catch (aiError) {
                    logger.error('[AI OCR] ❌ Błąd AI OCR:', aiError.message);
                    logger.warn('[AI OCR] 🔄 Fallback na tradycyjny OCR...');
                }
            }

            // === KROK 2: Tradycyjny Tesseract OCR (domyślny lub fallback) ===
            logger.info('[OCR] 🔄 Używam tradycyjnego OCR (Tesseract)...');

            // Wczytaj plik z dysku
            const fs = require('fs').promises;
            imageBuffer = await fs.readFile(filepath);

            processedBuffer = await this.processImageWithSharp(imageBuffer);

            logger.info('[OCR] 🔄 Uruchamianie Tesseract OCR...');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                tessedit_char_whitelist: this.config.ocr.polishAlphabet
            });

            logger.info('[OCR] 🔤 Odczytany tekst z OCR:');
            const textLines = text.split('\n').filter(line => line.trim().length > 0);
            textLines.forEach((line, index) => {
                logger.info(`${index + 1}: ${line.trim()}`);
            });

            // Zwolnij pamięć
            imageBuffer = null;
            processedBuffer = null;

            return text;
        } catch (error) {
            logger.error('[OCR] ❌ Błąd podczas przetwarzania pliku:', error);
            throw error;
        } finally {
            // Wymuś zwolnienie bufora z pamięci
            imageBuffer = null;
            processedBuffer = null;
        }
    }

    async processImageWithSharp(imageBuffer) {
        try {
            // Pobierz wymiary oryginalnego obrazu dla upscaling
            const metadata = await sharp(imageBuffer).metadata();
            const newWidth = Math.round(metadata.width * this.config.ocr.imageProcessing.upscale);
            const newHeight = Math.round(metadata.height * this.config.ocr.imageProcessing.upscale);
            
            // Ścieżka tymczasowa do zapisania przetworzonego obrazu
            const timestamp = Date.now();
            const tempOutputPath = path.join(this.processedDir, `temp_stalker_${timestamp}.png`);
            
            // Zaawansowane przetwarzanie obrazu dla czarnego tekstu
            const processedBuffer = await sharp(imageBuffer)
                .greyscale()
                // 1. Zwiększanie rozdzielczości x2 (nowe)
                .resize(newWidth, newHeight, { kernel: 'lanczos3' })
                // 2. Gamma correction (nowe)
                .gamma(this.config.ocr.imageProcessing.gamma)
                // 3. Median filter - redukcja szumów (nowe)
                .median(this.config.ocr.imageProcessing.median)
                // 4. Blur - rozmycie krawędzi (nowe)
                .blur(this.config.ocr.imageProcessing.blur)
                // 5. Normalizacja dla pełnego wykorzystania zakresu tonalnego (zachowane)
                .normalize()
                // 6. INWERSJA OBRAZU - biały tekst staje się czarnym (zachowane)
                .negate()
                // 7. Mocniejszy kontrast po inwersji dla ostrzejszego tekstu (zachowane)
                .linear(this.config.ocr.imageProcessing.contrast, -100)
                // 8. Wyostrzenie krawędzi tekstu (zachowane)
                .sharpen({ sigma: 0.5, m1: 0, m2: 2, x1: 2, y2: 10 })
                // 9. Operacja morfologiczna - zamykanie luk w literach (zachowane)
                .convolve({
                    width: 3,
                    height: 3,
                    kernel: [0, -1, 0, -1, 5, -1, 0, -1, 0]
                })
                // 10. Finalna binaryzacja - wszystkie odcienie szarości → białe, tekst → czarny (zachowane)
                .threshold(this.config.ocr.imageProcessing.whiteThreshold, { greyscale: false })
                .png();
            
            // Zapisz przetworzony obraz jeśli włączone (nowe)
            if (this.config.ocr.saveProcessedImages) {
                await processedBuffer.toFile(tempOutputPath);
                
                // Zapisz z właściwą nazwą i wywołaj czyszczenie
                await saveProcessedImage(
                    tempOutputPath,
                    this.processedDir,
                    'STALKER',
                    'stalker',
                    this.config.ocr.maxProcessedFiles,
                    logger
                );
                
                // Usuń plik tymczasowy
                await fs.unlink(tempOutputPath).catch(err => {
                    logger.warn(`⚠️ Nie udało się usunąć temp pliku ${tempOutputPath}: ${err.message}`);
                });
            }
            
            // Zwróć buffer do OCR
            const buffer = await processedBuffer.toBuffer();
            
            return buffer;
        } catch (error) {
            logger.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        }
    }

    async extractPlayersFromText(text, guild = null, requestingMember = null) {
        try {
            logger.info('Analiza tekstu');
            logger.info('🎯 Nowa logika: nick z roli → OCR → sprawdzanie końca linii...');
            
            if (!guild || !requestingMember) {
                logger.error('❌ Brak guild lub requestingMember - nie można kontynuować');
                return [];
            }
            
            // Krok 1: Pobierz nicki z odpowiedniej roli
            const roleNicks = await this.getRoleNicks(guild, requestingMember);
            if (roleNicks.length === 0) {
                logger.info('❌ Brak nicków z odpowiedniej roli');
                return [];
            }
            
            logger.info(`👥 Znaleziono ${roleNicks.length} nicków z roli: ${roleNicks.map(n => n.displayName).join(', ')}`);
            
            // Krok 2: Przygotuj linie OCR
            const lines = text.split('\n').filter(line => line.trim().length > 0);
            
            // Oblicz średnią długość linii dla informacji
            const avgLineLength = lines.reduce((sum, line) => sum + line.trim().length, 0) / lines.length;
            logger.info(`📏 Średnia długość linii: ${avgLineLength.toFixed(1)} znaków`);
            
            // Analizuj wszystkie linie (usuń filtrowanie według średniej)
            const validLines = lines.filter(line => line.trim().length >= 5); // Minimum 5 znaków
            logger.info(`📋 Analizuję ${validLines.length}/${lines.length} linii (minimum 5 znaków)`);
            
            const confirmedPlayers = [];
            const processedNicks = new Set(); // Śledzenie już przetworzonych nicków z zerem
            
            // Krok 3: Dla każdej linii znajdź najlepiej dopasowany nick z roli
            for (let i = 0; i < validLines.length; i++) {
                const line = validLines[i];
                const lineNumber = lines.findIndex(l => l.trim() === line.trim()) + 1;
                
                // Szczegółowe logowanie analizy linii
                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logLineAnalysis) {
                    logger.info(`   📋 Linia ${lineNumber}: "${line.trim()}"`);
                }
                
                // Znajdź najlepsze dopasowanie ze wszystkich nicków z roli
                let bestMatch = null;
                let bestSimilarity = 0;
                
                for (const roleNick of roleNicks) {
                    const similarity = this.calculateLineSimilarity(line, roleNick.displayName);
                    
                    // Szczegółowe logowanie podobieństwa
                    if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logSimilarityCalculations) {
                        if (similarity >= this.config.ocr.detailedLogging.similarityThreshold) {
                            logger.info(`      🔍 "${roleNick.displayName}" vs "${line.trim()}" → ${(similarity * 100).toFixed(1)}%`);
                        }
                    }
                    
                    // Dynamiczny próg podobieństwa na podstawie długości nicka
                    let requiredSimilarity = 0.6;
                    if (roleNick.displayName.length <= 5) {
                        requiredSimilarity = 0.75; // Wyższy próg dla krótkich nicków
                    } else if (roleNick.displayName.length <= 8) {
                        requiredSimilarity = 0.7;  // Średni próg dla średnich nicków
                    }
                    
                    if (similarity >= requiredSimilarity && 
                        (similarity > bestSimilarity || 
                         (similarity === bestSimilarity && roleNick.displayName.length > (bestMatch?.displayName?.length || 0)))) {
                        bestSimilarity = similarity;
                        bestMatch = roleNick;
                    }
                }
                
                if (bestMatch) {
                    // Szczegółowe logowanie dopasowania
                    if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logNickMatching) {
                        logger.info(`      ✅ Najlepsze dopasowanie: "${bestMatch.displayName}" (${(bestSimilarity * 100).toFixed(1)}%)`);
                    }
                    
                    // DODATKOWA WALIDACJA: Dla niskiego/średniego podobieństwa sprawdź czy to nie fragment innego słowa
                    const maxFragmentCheckSimilarity = bestMatch.displayName.length <= 5 ? 0.85 : 0.8;
                    if (bestSimilarity < maxFragmentCheckSimilarity) {
                        const lineLower = line.toLowerCase().trim();
                        const nickLower = bestMatch.displayName.toLowerCase();
                        
                        // Sprawdź czy nick znajduje się jako kompletne słowo, a nie fragment
                        const wordBoundaryPattern = new RegExp(`\\b${nickLower}\\b`);
                        if (!wordBoundaryPattern.test(lineLower)) {
                            // Nick nie występuje jako kompletne słowo - może być fragmentem
                            // Sprawdź czy cała linia może być jednym słowem zawierającym nick jako fragment
                            const words = lineLower.split(/\s+/);
                            const containsAsFragment = words.some(word => 
                                word.includes(nickLower) && word !== nickLower && word.length > nickLower.length
                            );
                            
                            if (containsAsFragment) {
                                logger.info(`      ⚠️ Nick "${bestMatch.displayName}" wykryty jako fragment słowa "${words.find(w => w.includes(nickLower) && w !== nickLower)}", pomijam`);
                                continue; // Pomiń to dopasowanie
                            }
                        }
                    }
                    
                    // Krok 4: Sprawdź koniec linii za nickiem dla wyniku
                    let endResult = this.analyzeLineEnd(line, bestMatch.displayName);
                    
                    // Szczegółowe logowanie analizy końca linii
                    if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logEndAnalysis) {
                        logger.info(`      🔚 Analiza końca linii: typ="${endResult.type}", wartość="${endResult.value}"`);
                    }
                    
                    // Jeśli nick ma 10+ liter i nie znaleziono wyniku/zera w tej linii, sprawdź następną linię
                    if (bestMatch.displayName.length >= 10 && endResult.type === 'unknown') {
                        // Znajdź rzeczywistą następną linię w oryginalnych liniach, nie w filtrowanych
                        const currentLineText = line.trim();
                        const allLines = text.split('\n').filter(line => line.trim().length > 0);
                        const currentLineIndex = allLines.findIndex(l => l.trim() === currentLineText);
                        
                        if (currentLineIndex !== -1 && currentLineIndex + 1 < allLines.length) {
                            const nextLine = allLines[currentLineIndex + 1];
                            const nextEndResult = this.analyzeLineEnd(nextLine, null); // W następnej linii nie szukamy za nickiem
                            
                            if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logEndAnalysis) {
                                logger.info(`      🔄 Sprawdzanie następnej linii dla długiego nicka: "${nextLine.trim()}"`);
                                logger.info(`      🔚 Wynik następnej linii: typ="${nextEndResult.type}", wartość="${nextEndResult.value}"`);
                            }
                            
                            if (nextEndResult.type !== 'unknown') {
                                endResult = nextEndResult;
                                if (this.config.ocr.detailedLogging.enabled && this.config.ocr.detailedLogging.logEndAnalysis) {
                                    logger.info(`      ✅ Użyto wyniku z następnej linii`);
                                }
                            }
                        }
                    }
                    
                    if (endResult.type === 'zero' || endResult.type === 'unknown') {
                        // Sprawdź czy ten nick z zerem już został przetworzony
                        if (processedNicks.has(bestMatch.displayName)) {
                            continue;
                        }
                        
                        // Sprawdź czy na końcu linii jest symbol © (niepewność)
                        const hasUncertainty = line.trim().endsWith('©');
                        
                        // Dodaj nick do zbioru przetworzonych
                        processedNicks.add(bestMatch.displayName);
                        
                        confirmedPlayers.push({
                            detectedNick: bestMatch.displayName,
                            user: bestMatch,
                            confirmed: true,
                            line: line.trim(),
                            endValue: endResult.value,
                            uncertain: hasUncertainty
                        });
                        
                        logger.info(`   ✅ Linia ${lineNumber}: "${bestMatch.displayName}" (${(bestSimilarity * 100).toFixed(1)}%) POTWIERDZONE ZERO!`);
                    } else if (endResult.type === 'negative') {
                        logger.info(`   ❌ Linia ${lineNumber}: "${bestMatch.displayName}" (${(bestSimilarity * 100).toFixed(1)}%) Wynik negatywny: ${endResult.value}`);
                    }
                } else {
                    // Nie loguj jeśli brak dopasowania - za dużo szumu
                }
            }
            
            const resultNicks = confirmedPlayers.map(p => p.detectedNick);

            logger.info(`📊 PODSUMOWANIE ANALIZY OCR:`);
            logger.info(`   🎯 Potwierdzonych graczy z zerem: ${confirmedPlayers.length}`);
            logger.info(`   👥 Lista: ${resultNicks.join(', ')}`);
            return confirmedPlayers;
        } catch (error) {
            logger.error('Błąd analizy tekstu');
            logger.error('❌ Błąd analizy tekstu:', error);
            return [];
        }
    }

    hasZeroScore(line) {
        // Convert problematic patterns to 0
        let processedLine = line.replace(/\(1\)/g, '0');  // Pattern (1)
        processedLine = processedLine.replace(/\[1\]/g, '0');  // Pattern [1]
        processedLine = processedLine.replace(/\[1(?!\])/g, '0'); // Pattern [1 (no closing bracket)
        processedLine = processedLine.replace(/\(1(?!\))/g, '0'); // Pattern (1 (no closing bracket)
        processedLine = processedLine.replace(/\(9\)/g, '0');  // Pattern (9) - treated as 0
        processedLine = processedLine.replace(/\[9\]/g, '0');  // Pattern [9] - treated as 0
        processedLine = processedLine.replace(/1\)/g, '0');   // Pattern 1) - treated as 0
        processedLine = processedLine.replace(/\(0\)/g, '0');  // Pattern (0) - treated as 0
        processedLine = processedLine.replace(/\[o\]/g, '0');  // Pattern [o] - treated as 0
        processedLine = processedLine.replace(/\(o\)/g, '0');  // Pattern (o) - treated as 0
        processedLine = processedLine.replace(/\(o/g, '0');  // Pattern (o - treated as 0
        processedLine = processedLine.replace(/o\)/g, '0');  // Pattern o) - treated as 0
        processedLine = processedLine.replace(/\[o/g, '0');  // Pattern [o - treated as 0
        processedLine = processedLine.replace(/o\]/g, '0');  // Pattern o] - treated as 0
        processedLine = processedLine.replace(/\([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\)/g, '0');  // Pattern (single letter) - treated as 0
        processedLine = processedLine.replace(/\[[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\]/g, '0');  // Pattern [single letter] - treated as 0
        processedLine = processedLine.replace(/\(\d\)/g, '0');  // Pattern (single digit) - treated as 0
        processedLine = processedLine.replace(/\[\d\]/g, '0');  // Pattern [single digit] - treated as 0
        // Pattern single letter with spaces - treated as 0 (but not if followed by digits)
        processedLine = processedLine.replace(/\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\s(?!\d)/g, ' 0 ');
        // Pattern single letter at end - treated as 0 (but only if not preceded by digit)
        processedLine = processedLine.replace(/(?<!\d)\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]$/g, ' 0');
        processedLine = processedLine.replace(/\s\d\s/g, ' 0 ');  // Pattern single digit with spaces - treated as 0
        processedLine = processedLine.replace(/\s\d$/g, ' 0');  // Pattern single digit at end - treated as 0
        
        const zeroPatterns = [
            /\s+0\s+/, /\s+0$/, /^0\s+/, /\s+0\.0\s+/, /\s+0\.0$/, /\s+0,0\s+/, /\s+0,0$/
        ];
        
        const oPatterns = [
            /\s+o\s+/, /\s+o$/, /^o\s+/
        ];
        
        // Check "zo" as score 0
        const zoPatterns = [
            /\s+zo\s+/, /\s+zo$/, /^zo\s+/
        ];
        
        // Check zero patterns
        for (const pattern of zeroPatterns) {
            if (pattern.test(processedLine)) {
                return true;
            }
        }
        
        // Check "zo" patterns
        for (const pattern of zoPatterns) {
            if (pattern.test(processedLine.toLowerCase())) {
                return true;
            }
        }
        
        // Check "e" patterns (błąd OCR dla 0)
        const ePatterns = [
            /\s+e\s+/, /\s+e$/, /^e\s+/
        ];
        
        // Check "o" patterns
        for (const pattern of oPatterns) {
            if (pattern.test(processedLine)) {
                const threeDigitPattern = /\d{3}$/;
                if (threeDigitPattern.test(processedLine.trim())) {
                    return false;
                }
                
                // Sprawdź czy po "o" nie ma dwóch liter lub cyfr
                const twoCharAfterOPattern = /o[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/;
                if (twoCharAfterOPattern.test(processedLine)) {
                    return false;
                }
                
                // Sprawdź czy po "o" nie ma spacji i dwóch liter/cyfr
                const spaceAndTwoCharPattern = /o\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/;
                if (spaceAndTwoCharPattern.test(processedLine)) {
                    return false;
                }
                
                return true;
            }
        }
        
        // Check "e" patterns (błąd OCR dla 0)
        for (const pattern of ePatterns) {
            if (pattern.test(processedLine)) {
                const threeDigitPattern = /\d{3}$/;
                if (threeDigitPattern.test(processedLine.trim())) {
                    return false;
                }
                
                // Sprawdź czy po "e" nie ma dwóch liter lub cyfr
                const twoCharAfterEPattern = /e[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/;
                if (twoCharAfterEPattern.test(processedLine)) {
                    return false;
                }
                
                // Sprawdź czy po "e" nie ma spacji i dwóch liter/cyfr
                const spaceAndTwoCharEPattern = /e\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/;
                if (spaceAndTwoCharEPattern.test(processedLine)) {
                    return false;
                }
                
                return true;
            }
        }
        
        
        return false;
    }

    getZeroElementsFromLine(line) {
        const zeroElements = [];
        
        // Wszystkie wzorce zero, które mogą wystąpić w linii
        const zeroPatterns = [
            /\(1\)/g, /\[1\]/g, /\[1(?!\])/g, /\(1(?!\))/g,
            /\(9\)/g, /\[9\]/g, /1\)/g, /\(0\)/g,
            /\[o\]/g, /\(o\)/g, /\(o/g, /o\)/g, /\[o/g, /o\]/g,
            /\([a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\)/g, /\[[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\]/g,
            /\(\d\)/g, /\[\d\]/g,
            /\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\s(?!\d)/g, /(?<!\d)\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]$/g,
            /\s\d\s/g, /\s\d$/g,
            /\s+0\s+/g, /\s+0$/g, /^0\s+/g, /\s+0\.0\s+/g, /\s+0\.0$/g, /\s+0,0\s+/g, /\s+0,0$/g,
            /\s+o\s+/g, /\s+o$/g, /^o\s+/g,
            /\s+e\s+/g, /\s+e$/g, /^e\s+/g,
            /\s+zo\s+/g, /\s+zo$/g, /^zo\s+/g,
            /\s+ze\s+/g, /\s+ze$/g, /^ze\s+/g
        ];
        
        // Znajdź wszystkie dopasowania w linii
        for (const pattern of zeroPatterns) {
            const matches = line.match(pattern);
            if (matches) {
                zeroElements.push(...matches.map(match => match.trim()));
            }
        }
        
        // Usuń duplikaty i puste stringi
        return [...new Set(zeroElements)].filter(element => element.length > 0);
    }

    async findSimilarUserOnServer(guild, detectedNick) {
        try {
            const members = await safeFetchMembers(guild, logger);
            let bestMatch = null;
            let bestSimilarity = 0;
            
            for (const [userId, member] of members) {
                const similarity = calculateNameSimilarity(detectedNick, member.displayName);
                
                if (similarity >= 0.7 && similarity > bestSimilarity) {
                    bestSimilarity = similarity;
                    bestMatch = {
                        userId: userId,
                        member: member,
                        displayName: member.displayName,
                        similarity: similarity
                    };
                }
            }
            
            return bestMatch;
        } catch (error) {
            logger.error('❌ Błąd wyszukiwania podobnego użytkownika:', error);
            return null;
        }
    }

    async confirmZeroWithAdditionalCheck(detectedNick, currentLine, allLines, currentIndex) {
        // Szukaj dodatkowego zera za nickiem w tej samej linii
        const nickPosition = currentLine.indexOf(detectedNick);
        if (nickPosition !== -1) {
            const afterNick = currentLine.substring(nickPosition + detectedNick.length);
            if (this.hasZeroScore(afterNick)) {
                logger.info(`   🔍 Znaleziono dodatkowe zero za nickiem w tej samej linii`);
                return true;
            }
        }
        
        // Jeśli nick jest długi (>15 znaków), sprawdź następną linię
        if (detectedNick.length > 15 && currentIndex + 1 < allLines.length) {
            const nextLine = allLines[currentIndex + 1];
            if (this.hasZeroScore(nextLine)) {
                logger.info(`   🔍 Znaleziono zero w następnej linii dla długiego nicka (${detectedNick.length} znaków)`);
                return true;
            }
        }
        
        return false;
    }

    isLikelyPlayerName(word) {
        // Sprawdzenie czy słowo prawdopodobnie jest nazwą gracza
        if (!word || word.length < 3 || word.length > 20) {
            return false;
        }
        
        // Odrzucamy czyste liczby
        if (/^\d+$/.test(word)) {
            return false;
        }
        
        // Odrzucamy słowa zawierające tylko znaki specjalne
        if (!/[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(word)) {
            return false;
        }
        
        return true;
    }

    isPlayerLine(line) {
        const patterns = [
            /\b\d+\b/,
            /\b0\b/,
            /damage/i,
            /dmg/i,
            /score/i,
            /points/i,
            /punkty/i,
            /obrażenia/i
        ];
        
        return patterns.some(pattern => pattern.test(line));
    }

    async findUsersInGuild(guild, playerNames, requestingMember = null) {
        try {
            logger.info('Wyszukiwanie użytkowników');
            logger.info(`🏰 Serwer: ${guild.name}`);
            logger.info(`🔍 Szukane nazwy: ${playerNames.join(', ')}`);

            const foundUsers = [];
            const members = await safeFetchMembers(guild, logger);
            
            // Sprawdź czy użytkownik ma którejś z ról TARGET i ogranicz wyszukiwanie
            let restrictToRole = null;
            if (requestingMember) {
                const targetRoleIds = Object.values(this.config.targetRoles);
                for (const roleId of targetRoleIds) {
                    if (requestingMember.roles.cache.has(roleId)) {
                        restrictToRole = roleId;
                        logger.info(`🎯 Ograniczam wyszukiwanie do roli: ${roleId}`);
                        break;
                    }
                }
            }
            
            for (const playerName of playerNames) {
                const candidates = [];
                
                for (const [userId, member] of members) {
                    // Jeśli jest ograniczenie do roli, sprawdź czy członek ma tę rolę
                    if (restrictToRole && !member.roles.cache.has(restrictToRole)) {
                        continue;
                    }
                    
                    // Sprawdź podobieństwo tylko z displayName (nick na serwerze)
                    const displaySimilarity = calculateNameSimilarity(playerName, member.displayName);
                    
                    if (displaySimilarity >= 0.7) {
                        candidates.push({
                            userId: userId,
                            member: member,
                            matchedName: playerName,
                            displayName: member.displayName,
                            similarity: displaySimilarity,
                            matchedField: 'displayName'
                        });
                    }
                }
                
                if (candidates.length > 0) {
                    // Sortuj kandydatów według podobieństwa (najwyższe pierwsze)
                    candidates.sort((a, b) => b.similarity - a.similarity);
                    
                    // Wybierz najlepszego kandydata
                    const bestMatch = candidates[0];
                    foundUsers.push({
                        userId: bestMatch.userId,
                        member: bestMatch.member,
                        matchedName: playerName,
                        displayName: bestMatch.displayName,
                        similarity: bestMatch.similarity
                    });
                    
                    logger.info(`✅ Dopasowano: ${playerName} -> ${bestMatch.member.displayName} - ${(bestMatch.similarity * 100).toFixed(1)}% podobieństwa`);
                    
                    // Pokaż alternatywnych kandydatów jeśli jest ich więcej
                    if (candidates.length > 1) {
                        logger.info(`   Alternatywni kandydaci:`);
                        for (let i = 1; i < Math.min(candidates.length, 3); i++) {
                            const alt = candidates[i];
                            logger.info(`   - ${alt.member.displayName} - ${(alt.similarity * 100).toFixed(1)}%`);
                        }
                    }
                } else {
                    logger.info(`❌ Nie znaleziono kandydata z minimum 70% podobieństwa dla: ${playerName}`);
                }
            }
            
            logger.info(`Dopasowano ${foundUsers.length}/${playerNames.length} użytkowników`);
            if (restrictToRole) {
                logger.info(`🎯 Wyszukiwanie ograniczone do roli: ${restrictToRole}`);
            }
            return foundUsers;
        } catch (error) {
            logger.error('Błąd wyszukiwania');
            logger.error('❌ Błąd wyszukiwania użytkowników:', error);
            return [];
        }
    }

    async getRoleNicks(guild, requestingMember) {
        try {
            const targetRoleIds = Object.values(this.config.targetRoles);
            let userRoleId = null;

            // Znajdź rolę użytkownika wykonującego polecenie
            for (const roleId of targetRoleIds) {
                if (requestingMember.roles.cache.has(roleId)) {
                    userRoleId = roleId;
                    break;
                }
            }

            if (!userRoleId) {
                logger.info('❌ Użytkownik nie posiada żadnej z ról TARGET');
                return [];
            }

            logger.info(`📥 Pobieranie członków z rolą ${userRoleId}...`);

            // Użyj bezpośrednio cache roli - znacznie szybsze niż fetch wszystkich członków
            const role = guild.roles.cache.get(userRoleId);

            if (!role) {
                logger.error(`❌ Nie znaleziono roli ${userRoleId} w cache`);
                return [];
            }

            // Pobierz członków bezpośrednio z roli (używa cache)
            const members = role.members;

            const roleMembers = [];
            for (const [userId, member] of members) {
                roleMembers.push({
                    userId: userId,
                    member: member,
                    displayName: member.displayName
                });
            }

            logger.info(`👥 Znaleziono ${roleMembers.length} członków z rolą ${userRoleId}`);
            return roleMembers;
        } catch (error) {
            logger.error('❌ Błąd pobierania nicków z roli:');
            logger.error(`   Typ błędu: ${error.name}`);
            logger.error(`   Kod: ${error.code || 'brak'}`);
            logger.error(`   Wiadomość: ${error.message}`);
            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
            }
            return [];
        }
    }

    /**
     * Zapisuje snapshot nicków z roli do pliku
     * @param {Guild} guild - Obiekt serwera Discord
     * @param {GuildMember} requestingMember - Członek wykonujący polecenie
     * @param {string} snapshotPath - Ścieżka do pliku snapshot
     * @returns {Promise<boolean>} - true jeśli sukces, false w przeciwnym razie
     */
    async saveRoleNicksSnapshot(guild, requestingMember, snapshotPath) {
        try {
            logger.info(`💾 Tworzenie snapshotu nicków do pliku: ${snapshotPath}`);

            // Pobierz nicki używając istniejącej metody
            const roleNicks = await this.getRoleNicks(guild, requestingMember);

            if (roleNicks.length === 0) {
                logger.warn('⚠️ Nie znaleziono członków z roli - snapshot będzie pusty');
            }

            // Zapisz do pliku z metadanymi
            const snapshotData = {
                timestamp: Date.now(),
                guildId: guild.id,
                userId: requestingMember.id,
                count: roleNicks.length,
                members: roleNicks.map(rm => ({
                    userId: rm.userId,
                    displayName: rm.displayName
                }))
            };

            // Upewnij się że katalog istnieje
            const dir = path.dirname(snapshotPath);
            await fs.mkdir(dir, { recursive: true });

            await fs.writeFile(snapshotPath, JSON.stringify(snapshotData, null, 2), 'utf8');
            logger.info(`✅ Zapisano snapshot ${roleNicks.length} członków do pliku`);

            return true;
        } catch (error) {
            logger.error('❌ Błąd zapisywania snapshotu nicków:', error);
            return false;
        }
    }

    /**
     * Ładuje snapshot nicków z pliku
     * @param {string} snapshotPath - Ścieżka do pliku snapshot
     * @returns {Promise<Array>} - Tablica członków w formacie [{userId, displayName}]
     */
    async loadRoleNicksSnapshot(snapshotPath) {
        try {
            const fileContent = await fs.readFile(snapshotPath, 'utf8');
            const snapshotData = JSON.parse(fileContent);

            logger.info(`📂 Załadowano snapshot ${snapshotData.count} członków z pliku (utworzony: ${new Date(snapshotData.timestamp).toLocaleString('pl-PL')})`);

            // Zwróć w formacie zgodnym z getRoleNicks (bez obiektu member)
            return snapshotData.members.map(m => ({
                userId: m.userId,
                displayName: m.displayName,
                member: null // snapshot nie zawiera pełnego obiektu member
            }));
        } catch (error) {
            logger.error(`❌ Błąd ładowania snapshotu nicków z ${snapshotPath}:`, error);
            return [];
        }
    }

    /**
     * Usuwa plik snapshot
     * @param {string} snapshotPath - Ścieżka do pliku snapshot
     */
    async deleteRoleNicksSnapshot(snapshotPath) {
        try {
            await fs.unlink(snapshotPath);
            logger.info(`🗑️ Usunięto snapshot nicków: ${snapshotPath}`);
        } catch (error) {
            if (error.code !== 'ENOENT') { // Ignoruj błąd jeśli plik nie istnieje
                logger.warn(`⚠️ Błąd usuwania snapshotu ${snapshotPath}:`, error.message);
            }
        }
    }


    calculateLineSimilarity(line, nick) {
        const lineLower = line.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, ''); // Usuń wszystkie znaki specjalne oprócz polskich
        const nickLower = nick.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
        
        // Sprawdź czy nick występuje w linii, ale tylko jeśli nick ma 3+ znaki
        // To zapobiega false positive dla krótkich fragmentów jak "21"
        if (nickLower.length >= 3 && lineLower.includes(nickLower)) {
            return 1.0; // 100% jeśli nick jest w linii
        }
        
        // Dodatkowe sprawdzenie: czy nick występuje z małymi błędami OCR
        if (nickLower.length >= 5) {
            const similarity = this.calculateFuzzyMatch(lineLower, nickLower);
            if (similarity >= 0.9) {
                return similarity; // Wysokie podobieństwo dla prawie idealnych dopasowań
            }
        }
        
        // Oblicz podobieństwo na podstawie kolejnych znaków z nicku
        return this.calculateOrderedSimilarity(lineLower, nickLower);
    }

    /**
     * Oblicza podobieństwo z tolerancją na małe błędy OCR
     * Szuka nicka w linii z możliwością 1-2 błędnych znaków
     */
    calculateFuzzyMatch(lineLower, nickLower) {
        // Szukaj pozycji gdzie nick może się zaczynać
        for (let i = 0; i <= lineLower.length - nickLower.length; i++) {
            const substring = lineLower.substring(i, i + nickLower.length);
            
            // Oblicz liczbę różnych znaków
            let differences = 0;
            for (let j = 0; j < nickLower.length; j++) {
                if (substring[j] !== nickLower[j]) {
                    differences++;
                }
            }
            
            // Jeśli różnica to maksymalnie 2 znaki dla nicków 8+ znaków
            // lub 1 znak dla nicków 5-7 znaków
            const maxDifferences = nickLower.length >= 8 ? 2 : 1;
            
            if (differences <= maxDifferences) {
                const similarity = 1 - (differences / nickLower.length);
                return Math.max(0.9, similarity); // Minimum 90% dla fuzzy match
            }
        }
        
        return 0; // Brak fuzzy match
    }

    /**
     * Oblicza podobieństwo na podstawie kolejnych znaków z nicku znalezionych w linii OCR
     * @param {string} ocrText - Tekst z OCR (bez znaków specjalnych)
     * @param {string} nick - Nick do sprawdzenia (bez znaków specjalnych)
     * @returns {number} Podobieństwo 0-1
     */
    calculateOrderedSimilarity(ocrText, nick) {
        if (!nick || nick.length === 0) return 0;
        if (!ocrText || ocrText.length === 0) return 0;
        
        // Dla bardzo krótkich nicków (1-2 znaki) wymagaj wyższego progu podobieństwa
        if (nick.length <= 2) {
            // Dla krótkich nicków wymagaj dokładnego dopasowania lub bardzo wysokiej jakości
            const exactMatch = ocrText === nick;
            if (exactMatch) return 1.0;
            
            // W przeciwnym razie znacznie obniż podobieństwo dla krótkich nicków
            const baseSimilarity = this.calculateBasicOrderedSimilarity(ocrText, nick);
            return baseSimilarity * 0.3; // Drastyczne obniżenie dla krótkich nicków
        }
        
        return this.calculateBasicOrderedSimilarity(ocrText, nick);
    }
    
    calculateBasicOrderedSimilarity(ocrText, nick) {
        let matchedChars = 0;
        let ocrIndex = 0;
        
        // Przejdź przez każdy znak w nicku i sprawdź czy występuje w kolejności w OCR
        for (let nickIndex = 0; nickIndex < nick.length; nickIndex++) {
            const nickChar = nick[nickIndex];
            
            // Znajdź ten znak w OCR począwszy od aktualnej pozycji
            let found = false;
            for (let i = ocrIndex; i < ocrText.length; i++) {
                if (ocrText[i] === nickChar) {
                    matchedChars++;
                    ocrIndex = i + 1; // Przesuń się za znaleziony znak
                    found = true;
                    break;
                }
            }
            
            // Jeśli nie znaleziono znaku, kontynuuj (nie resetuj ocrIndex)
            if (!found) {
                // Można dodać penalty za brak znaku, ale na razie kontynuujemy
            }
        }
        
        // Podstawowe podobieństwo = znalezione znaki / całkowita długość nicku
        const baseSimilarity = matchedChars / nick.length;
        
        // Oblicz karę za różnicę w długości (proporcjonalny system)
        const lengthDifference = Math.abs(ocrText.length - nick.length);
        const maxLength = Math.max(ocrText.length, nick.length);
        const lengthDifferencePercent = maxLength > 0 ? lengthDifference / maxLength : 0;
        
        // Proporcjonalna kara: jeśli różnica 50% = dziel przez 2, 25% = dziel przez 1.5, itd.
        // Wzór: dzielnik = 1 + (procent różnicy)
        const lengthPenaltyDivisor = 1 + lengthDifferencePercent;
        const finalSimilarity = baseSimilarity / lengthPenaltyDivisor;
        
        return Math.max(0, finalSimilarity);
    }

    analyzeLineEnd(line, nickName = null) {
        const trimmedLine = line.trim();
        const words = trimmedLine.split(/\s+/);
        
        let searchText = trimmedLine;
        
        // Jeśli mamy nick, szukaj tylko za nickiem
        if (nickName) {
            const nickIndex = trimmedLine.toLowerCase().indexOf(nickName.toLowerCase());
            if (nickIndex !== -1) {
                // Tekst za nickiem
                searchText = trimmedLine.substring(nickIndex + nickName.length).trim();
                if (searchText.length === 0) {
                    return { type: 'unknown', value: 'brak tekstu za nickiem' };
                }
                
                // NOWA WALIDACJA: Sprawdź czy "tekst za nickiem" nie jest częścią samego nicka
                // To się dzieje gdy OCR błędnie rozpoznaje nick lub gdy mamy częściowe dopasowanie
                const originalLine = trimmedLine.toLowerCase();
                const nickLower = nickName.toLowerCase();
                const searchTextLower = searchText.toLowerCase();
                
                // Jeśli całą linię można interpretować jako ciągły tekst (nick+końcówka)
                // i nie ma wyraźnego separatora (spacja, przecinek, etc.) między nickiem a tekstem
                if (searchTextLower.length <= 3 && 
                    !searchText.match(/^\s/) && // nie zaczyna się od spacji
                    !searchText.match(/^[,.\-_|]/) && // nie zaczyna się od separatora
                    originalLine === (nickLower + searchTextLower)) { // cała linia to nick+końcówka
                    
                    // Sprawdź czy to może być błędne rozpoznanie nicka jako nick+wynik
                    // Przykład: "boisz" rozpoznane jako "Boqus" + "z"
                    return { type: 'unknown', value: `możliwa część nicka: "${searchText}"` };
                }
            }
        }
        
        const searchWords = searchText.split(/\s+/);
        const lastWord = searchWords[searchWords.length - 1];
        
        // Sprawdź wzorce zera w tekście za nickiem
        if (this.isZeroPattern(lastWord)) {
            return { type: 'zero', value: lastWord };
        }
        
        // Sprawdź czy w tekście za nickiem są liczby 2+ cyfrowe
        const numberMatches = searchText.match(/\d{2,}/g);
        if (numberMatches && numberMatches.length > 0) {
            // Znajdź ostatnią liczbę 2+ cyfrową za nickiem
            const lastNumber = numberMatches[numberMatches.length - 1];
            return { type: 'negative', value: lastNumber };
        }
        
        // Sprawdź czy to może być wzorzec zera w tekście za nickiem
        for (const word of searchWords) {
            if (this.isZeroPattern(word)) {
                return { type: 'zero', value: word };
            }
        }
        
        return { type: 'unknown', value: lastWord };
    }

    isZeroPattern(word) {
        // Wszystkie wzorce zera z wcześniejszych rozmów
        const zeroPatterns = [
            // Czyste cyfry
            /^0$/,                    // czyste 0
            /^1$/,                    // czyste 1
            /^9$/,                    // czyste 9
            /^o$/,                    // czyste o
            /^e$/,                    // czyste e (błąd OCR)
            
            // W nawiasach okrągłych
            /^\(0\)$/,               // (0)
            /^\(1\)$/,               // (1)
            /^\(9\)$/,               // (9)
            /^\(o\)$/,               // (o)
            /^\(e\)$/,               // (e) - błąd OCR
            
            // W nawiasach kwadratowych
            /^\[0\]$/,               // [0]
            /^\[1\]$/,               // [1]
            /^\[9\]$/,               // [9]
            /^\[o\]$/,               // [o]
            /^\[e\]$/,               // [e] - błąd OCR
            
            // Z nawiasem na końcu
            /^0\)$/,                 // 0)
            /^1\)$/,                 // 1)
            /^9\)$/,                 // 9)
            /^o\)$/,                 // o)
            /^e\)$/,                 // e) - błąd OCR
            
            // Z otwartym nawiasem okrągłym na początku
            /^\(0$/,                 // (0
            /^\(1$/,                 // (1
            /^\(9$/,                 // (9
            /^\(o$/,                 // (o
            /^\(e$/,                 // (e - błąd OCR
            
            // Z otwartym nawiasem kwadratowym na początku
            /^\[0$/,                 // [0
            /^\[1$/,                 // [1
            /^\[9$/,                 // [9
            /^\[o$/,                 // [o
            /^\[e$/,                 // [e - błąd OCR
            
            // Z zamkniętym nawiasem kwadratowym na końcu
            /^0\]$/,                 // 0]
            /^1\]$/,                 // 1]
            /^9\]$/,                 // 9]
            /^o\]$/,                 // o]
            /^e\]$/,                 // e] - błąd OCR
            
            // Dodatkowe wzorce
            /^zo$/,                  // zo
            /^ze$/                   // ze - błąd OCR
        ];
        
        const wordLower = word.toLowerCase();
        
        // Sprawdź czy po "o" nie ma dwóch liter lub cyfr (dla wzorców zaczynających się od "o")
        if (wordLower.startsWith('o') && wordLower.length >= 3) {
            const afterO = wordLower.substring(1);
            if (/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/.test(afterO)) {
                return false;
            }
        }
        
        // Sprawdź czy po "o" nie ma spacji i dwóch liter/cyfr
        const spaceAndTwoCharPattern = /o\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9]{2,}/;
        if (spaceAndTwoCharPattern.test(wordLower)) {
            return false;
        }
        
        for (const pattern of zeroPatterns) {
            if (pattern.test(wordLower)) {
                return true;
            }
        }
        
        return false;
    }

    /**
     * Wyciąga wszystkich graczy z ich wynikami (nie tylko z zerem)
     * Używane dla komendy /faza1
     * @param {string} snapshotPath - Opcjonalna ścieżka do pliku snapshot z nickami
     */
    async extractAllPlayersWithScores(text, guild = null, requestingMember = null, snapshotPath = null) {
        try {
            logger.info('[PHASE1] 🎯 Rozpoczynam ekstrakcję wszystkich graczy z wynikami...');

            if (!guild || !requestingMember) {
                logger.error('[PHASE1] ❌ Brak guild lub requestingMember - nie można kontynuować');
                return [];
            }

            // Pobierz nicki - ze snapshotu jeśli podano, lub z roli
            let roleNicks;
            if (snapshotPath) {
                logger.info('[PHASE1] 📂 Używam snapshotu nicków zamiast pobierania na żywo');
                roleNicks = await this.loadRoleNicksSnapshot(snapshotPath);
            } else {
                logger.info('[PHASE1] 📥 Pobieranie nicków z roli (brak snapshotu)');
                roleNicks = await this.getRoleNicks(guild, requestingMember);
            }

            if (roleNicks.length === 0) {
                logger.info('[PHASE1] ❌ Brak nicków z odpowiedniej roli');
                return [];
            }

            logger.info(`[PHASE1] 👥 Znaleziono ${roleNicks.length} nicków z roli`);

            // Przygotuj linie OCR
            const lines = text.split('\n').filter(line => line.trim().length > 0);
            const validLines = lines.filter(line => line.trim().length >= 5);

            logger.info(`[PHASE1] 📋 Analizuję ${validLines.length}/${lines.length} linii`);

            const playersWithScores = [];
            const processedNicks = new Set();

            // Dla każdej linii znajdź najlepiej dopasowany nick z roli
            for (let i = 0; i < validLines.length; i++) {
                const line = validLines[i];

                // Znajdź najlepsze dopasowanie ze wszystkich nicków z roli
                let bestMatch = null;
                let bestSimilarity = 0;

                for (const roleNick of roleNicks) {
                    const similarity = this.calculateLineSimilarity(line, roleNick.displayName);

                    let requiredSimilarity = 0.6;
                    if (roleNick.displayName.length <= 5) {
                        requiredSimilarity = 0.75;
                    } else if (roleNick.displayName.length <= 8) {
                        requiredSimilarity = 0.7;
                    }

                    if (similarity >= requiredSimilarity &&
                        (similarity > bestSimilarity ||
                         (similarity === bestSimilarity && roleNick.displayName.length > (bestMatch?.displayName?.length || 0)))) {
                        bestSimilarity = similarity;
                        bestMatch = roleNick;
                    }
                }

                if (bestMatch) {
                    // Sprawdź czy już przetworzyliśmy tego gracza
                    if (processedNicks.has(bestMatch.displayName)) {
                        continue;
                    }

                    // Wyciągnij wynik z końca linii
                    const endResult = this.analyzeLineEnd(line, bestMatch.displayName);

                    // Jeśli nick ma 10+ liter i nie znaleziono wyniku w tej linii, sprawdź następną
                    let finalScore = 0; // DOMYŚLNIE 0 zamiast null

                    if (bestMatch.displayName.length >= 10 && endResult.type === 'unknown') {
                        const currentLineText = line.trim();
                        const allLines = text.split('\n').filter(line => line.trim().length > 0);
                        const currentLineIndex = allLines.findIndex(l => l.trim() === currentLineText);

                        if (currentLineIndex !== -1 && currentLineIndex + 1 < allLines.length) {
                            const nextLine = allLines[currentLineIndex + 1];
                            const nextEndResult = this.analyzeLineEnd(nextLine, null);

                            if (nextEndResult.type === 'zero') {
                                finalScore = 0;
                            } else if (nextEndResult.type === 'negative') {
                                finalScore = parseInt(nextEndResult.value) || 0;
                            }
                        }
                        // Jeśli nie znaleziono wyniku w następnej linii, pozostaje 0
                    } else {
                        // Wynik w tej samej linii
                        if (endResult.type === 'zero') {
                            finalScore = 0;
                        } else if (endResult.type === 'negative') {
                            finalScore = parseInt(endResult.value) || 0;
                        } else if (endResult.type === 'unknown') {
                            // Spróbuj wyciągnąć liczbę z wartości
                            const numberMatch = endResult.value.match(/\d+/);
                            if (numberMatch) {
                                finalScore = parseInt(numberMatch[0]) || 0;
                            }
                            // Jeśli nie znaleziono liczby, pozostaje 0
                        }
                    }

                    // Dodaj gracza z wynikiem (finalScore jest zawsze liczbą, nigdy null)
                    processedNicks.add(bestMatch.displayName);

                    playersWithScores.push({
                        nick: bestMatch.displayName,
                        score: finalScore
                    });

                    logger.info(`[PHASE1] ✅ "${bestMatch.displayName}" → ${finalScore} punktów`);
                }
            }

            logger.info(`[PHASE1] 📊 Znaleziono ${playersWithScores.length} graczy z wynikami`);
            return playersWithScores;

        } catch (error) {
            logger.error('[PHASE1] ❌ Błąd ekstrakcji graczy z wynikami:', error);
            return [];
        }
    }

    // ==================== WYŚWIETLANIE KOLEJKI OCR ====================

    /**
     * Tworzy embed z aktualną kolejką OCR
     */
    async createQueueEmbed(guildId) {
        const queue = this.waitingQueue.get(guildId) || [];
        const active = this.activeProcessing.get(guildId);
        const reservation = this.queueReservation.get(guildId);

        // Dynamiczny kolor embeda
        let embedColor = '#00FF00'; // Zielony (domyślnie - pusta kolejka)

        if (active || reservation) {
            // Jeśli coś jest w użyciu lub jest rezerwacja
            if (queue.length > 2) {
                embedColor = '#FF0000'; // Czerwony (więcej niż 2 osoby w kolejce)
            } else {
                embedColor = '#FFA500'; // Żółty (w użyciu, max 2 osoby)
            }
        } else if (queue.length > 2) {
            embedColor = '#FF0000'; // Czerwony (więcej niż 2 osoby czeka)
        } else if (queue.length > 0) {
            embedColor = '#FFA500'; // Żółty (1-2 osoby czekają)
        }

        const embed = new EmbedBuilder()
            .setTitle('📋 Kolejka OCR')
            .setColor(embedColor)
            .setTimestamp()
            .setFooter({ text: 'Aktualizowane automatycznie' });

        let description = '';

        // Aktywne przetwarzanie
        if (active) {
            try {
                const guild = await this.client.guilds.fetch(guildId);
                const member = await guild.members.fetch(active.userId);
                const expiryTimestamp = Math.floor(active.expiresAt / 1000);
                description += `🔒 **Aktualnie w użyciu:**\n`;
                description += `${member.displayName} - \`${active.commandName}\` (wygasa <t:${expiryTimestamp}:R>)\n\n`;
            } catch (error) {
                const expiryTimestamp = Math.floor(active.expiresAt / 1000);
                description += `🔒 **Aktualnie w użyciu:**\n`;
                description += `Użytkownik ${active.userId} - \`${active.commandName}\` (wygasa <t:${expiryTimestamp}:R>)\n\n`;
            }
        }

        // Rezerwacja
        if (reservation && !active) {
            try {
                const guild = await this.client.guilds.fetch(guildId);
                const member = await guild.members.fetch(reservation.userId);
                const expiryTimestamp = Math.floor(reservation.expiresAt / 1000);
                description += `⏰ **Rezerwacja:**\n`;
                description += `${member.displayName} - \`${reservation.commandName}\` (wygasa <t:${expiryTimestamp}:R>)\n\n`;
            } catch (error) {
                description += `⏰ **Rezerwacja:**\n`;
                description += `Użytkownik ${reservation.userId} - \`${reservation.commandName}\`\n\n`;
            }
        }

        // Kolejka oczekujących
        if (queue.length > 0) {
            description += `⏳ **Kolejka oczekujących:** (${queue.length})\n\n`;

            const guild = await this.client.guilds.fetch(guildId);
            for (let i = 0; i < queue.length; i++) {
                const person = queue[i];
                try {
                    const member = await guild.members.fetch(person.userId);
                    description += `**${i + 1}.** ${member.displayName} - \`${person.commandName}\`\n`;
                } catch (error) {
                    description += `**${i + 1}.** Użytkownik ${person.userId} - \`${person.commandName}\`\n`;
                }
            }
        } else if (!active && !reservation) {
            description += `✅ **Kolejka pusta**\n\nOCR jest dostępny do użycia!`;
        }

        embed.setDescription(description || 'Brak danych');
        return embed;
    }

    /**
     * Aktualizuje wyświetlanie kolejki na kanale
     */
    async updateQueueDisplay(guildId) {
        try {
            if (!this.client || !this.queueChannelId) return;

            const channel = await this.client.channels.fetch(this.queueChannelId);
            if (!channel) {
                logger.warn('[OCR-QUEUE] ⚠️ Nie znaleziono kanału kolejki');
                return;
            }

            const embed = await this.createQueueEmbed(guildId);

            // Dodaj przyciski komend i przycisk "Wyjdź z kolejki"
            const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

            // Przyciski w jednym rzędzie
            const faza1Button = new ButtonBuilder()
                .setCustomId('queue_cmd_faza1')
                .setLabel('Faza 1')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Secondary);

            const faza2Button = new ButtonBuilder()
                .setCustomId('queue_cmd_faza2')
                .setLabel('Faza 2')
                .setEmoji('📈')
                .setStyle(ButtonStyle.Secondary);

            const remindButton = new ButtonBuilder()
                .setCustomId('queue_cmd_remind')
                .setLabel('Remind')
                .setEmoji('📢')
                .setStyle(ButtonStyle.Secondary);

            const punishButton = new ButtonBuilder()
                .setCustomId('queue_cmd_punish')
                .setLabel('Punish')
                .setEmoji('💀')
                .setStyle(ButtonStyle.Secondary);

            const leaveQueueButton = new ButtonBuilder()
                .setCustomId('queue_leave')
                .setLabel('Wyjdź z kolejki')
                .setEmoji('🚪')
                .setStyle(ButtonStyle.Danger);

            const dodajButton = new ButtonBuilder()
                .setCustomId('queue_cmd_dodaj')
                .setLabel('Dodaj brakujący wynik')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success);

            const modyfikujButton = new ButtonBuilder()
                .setCustomId('queue_cmd_modyfikuj')
                .setLabel('Modyfikuj wynik')
                .setEmoji('✏️')
                .setStyle(ButtonStyle.Success);

            const imgButton = new ButtonBuilder()
                .setCustomId('queue_cmd_img')
                .setLabel('Dodaj zdjęcie rankingu')
                .setEmoji('📷')
                .setStyle(ButtonStyle.Success);

            const clanStatusButton = new ButtonBuilder()
                .setCustomId('queue_cmd_clan_status')
                .setLabel('Status klanów')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Primary);

            const clanProgresButton = new ButtonBuilder()
                .setCustomId('queue_cmd_clan_progres')
                .setLabel('Progres klanów')
                .setEmoji('📈')
                .setStyle(ButtonStyle.Primary);

            const wynikiButton = new ButtonBuilder()
                .setCustomId('queue_cmd_wyniki')
                .setLabel('Wyniki klanów')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Primary);

            const wdupieButton = new ButtonBuilder()
                .setCustomId('queue_cmd_player_raport')
                .setLabel('Gracze o potencjalnie wysokim poziomie wypalenia')
                .setEmoji('🔍')
                .setStyle(ButtonStyle.Danger);

            const row1 = new ActionRowBuilder()
                .addComponents(faza1Button, faza2Button, remindButton, punishButton, leaveQueueButton);

            const row2 = new ActionRowBuilder()
                .addComponents(dodajButton, modyfikujButton, imgButton);

            const row3 = new ActionRowBuilder()
                .addComponents(clanStatusButton, clanProgresButton, wynikiButton);

            const row4 = new ActionRowBuilder()
                .addComponents(wdupieButton);

            // Jeśli mamy zapisane ID wiadomości, spróbuj zaktualizować
            if (this.queueMessageId) {
                try {
                    const message = await channel.messages.fetch(this.queueMessageId);
                    await message.edit({ embeds: [embed], components: [row1, row2, row3, row4] });
                    logger.info('[OCR-QUEUE] 📝 Zaktualizowano embed kolejki');
                    return;
                } catch (error) {
                    // Wiadomość nie istnieje lub została usunięta
                    logger.warn('[OCR-QUEUE] ⚠️ Nie można zaktualizować embeda, tworzę nowy jako pierwszą wiadomość');
                    this.queueMessageId = null;
                }
            }

            // Nie wysyłaj nowej wiadomości - zostanie wysłana podczas inicjalizacji bota
            logger.warn('[OCR-QUEUE] ⚠️ Brak embeda kolejki - zostanie utworzony podczas inicjalizacji');
        } catch (error) {
            logger.error('[OCR-QUEUE] ❌ Błąd aktualizacji wyświetlania kolejki:', error);
        }
    }


    /**
     * Czyści wiadomości z kanału kolejki (zostawia tylko pierwszą z embedem)
     */
    async cleanupQueueChannelMessages() {
        try {
            if (!this.client || !this.queueChannelId) {
                return;
            }

            const channel = await this.client.channels.fetch(this.queueChannelId);
            if (!channel) {
                return;
            }

            // Pobierz wszystkie wiadomości z kanału
            const messages = await channel.messages.fetch({ limit: 100 });

            let deletedCount = 0;
            for (const [messageId, message] of messages) {
                // Pomiń pierwszą wiadomość z embedem kolejki
                if (messageId === this.queueMessageId) {
                    continue;
                }

                // Usuń wszystkie inne wiadomości
                try {
                    await message.delete();
                    deletedCount++;
                } catch (error) {
                    // Ignoruj błędy usuwania (np. brak uprawnień)
                }
            }

            if (deletedCount > 0) {
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono ${deletedCount} wiadomości z kanału kolejki`);
            }
        } catch (error) {
            // Ignoruj błędy czyszczenia
        }
    }

    /**
     * Czyści wszystkie wiadomości z kanału kolejki OCR
     */
    async cleanupQueueChannel() {
        try {
            if (!this.client || !this.queueChannelId) {
                logger.warn('[OCR-QUEUE] ⚠️ Brak klienta lub kanału kolejki do wyczyszczenia');
                return;
            }

            logger.info('[OCR-QUEUE] 🧹 Rozpoczynam czyszczenie kanału kolejki...');

            const channel = await this.client.channels.fetch(this.queueChannelId);
            if (!channel) {
                logger.warn('[OCR-QUEUE] ⚠️ Nie znaleziono kanału kolejki');
                return;
            }

            // Pobierz wszystkie wiadomości z kanału (maksymalnie 100)
            const messages = await channel.messages.fetch({ limit: 100 });

            if (messages.size === 0) {
                logger.info('[OCR-QUEUE] ✅ Kanał kolejki jest już pusty');
                // Wyślij nowy embed
                await this.updateQueueDisplay(channel.guildId);
                return;
            }

            // Usuń wszystkie wiadomości
            let deletedCount = 0;
            for (const [messageId, message] of messages) {
                try {
                    await message.delete();
                    deletedCount++;
                } catch (error) {
                    logger.warn(`[OCR-QUEUE] ⚠️ Nie można usunąć wiadomości ${messageId}: ${error.message}`);
                }
            }

            logger.info(`[OCR-QUEUE] 🗑️ Usunięto ${deletedCount} wiadomości z kanału kolejki`);

            // Resetuj ID embeda kolejki
            this.queueMessageId = null;

            // Wyślij nowy embed kolejki
            await this.updateQueueDisplay(channel.guildId);

            logger.info('[OCR-QUEUE] ✅ Czyszczenie kanału kolejki zakończone');
        } catch (error) {
            logger.error('[OCR-QUEUE] ❌ Błąd czyszczenia kanału kolejki:', error);
        }
    }

    /**
     * Inicjalizuje wyświetlanie kolejki podczas startu bota
     */
    async initializeQueueDisplay(client) {
        try {
            if (!this.queueChannelId) {
                logger.warn('[OCR-QUEUE] ⚠️ Brak skonfigurowanego kanału kolejki');
                return;
            }

            logger.info('[OCR-QUEUE] 🚀 Inicjalizacja wyświetlania kolejki...');

            const channel = await client.channels.fetch(this.queueChannelId);
            if (!channel) {
                logger.warn('[OCR-QUEUE] ⚠️ Nie znaleziono kanału kolejki');
                return;
            }

            // Pobierz wszystkie wiadomości z kanału
            const messages = await channel.messages.fetch({ limit: 100 });

            // Znajdź PIERWSZĄ wiadomość od bota z embedem kolejki (najstarsza)
            let queueMessage = null;
            for (const [messageId, message] of messages) {
                if (message.author.id === client.user.id &&
                    message.embeds.length > 0 &&
                    message.embeds[0].title === '📋 Kolejka OCR') {
                    queueMessage = message;
                    // Nie break - chcemy znaleźć najstarszą (iterujemy od najnowszych do najstarszych)
                }
            }

            const embed = await this.createQueueEmbed(channel.guildId);
            const { ButtonBuilder, ActionRowBuilder, ButtonStyle } = require('discord.js');

            // Przyciski w jednym rzędzie
            const faza1Button = new ButtonBuilder()
                .setCustomId('queue_cmd_faza1')
                .setLabel('Faza 1')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Secondary);

            const faza2Button = new ButtonBuilder()
                .setCustomId('queue_cmd_faza2')
                .setLabel('Faza 2')
                .setEmoji('📈')
                .setStyle(ButtonStyle.Secondary);

            const remindButton = new ButtonBuilder()
                .setCustomId('queue_cmd_remind')
                .setLabel('Remind')
                .setEmoji('📢')
                .setStyle(ButtonStyle.Secondary);

            const punishButton = new ButtonBuilder()
                .setCustomId('queue_cmd_punish')
                .setLabel('Punish')
                .setEmoji('💀')
                .setStyle(ButtonStyle.Secondary);

            const leaveQueueButton = new ButtonBuilder()
                .setCustomId('queue_leave')
                .setLabel('Wyjdź z kolejki')
                .setEmoji('🚪')
                .setStyle(ButtonStyle.Danger);

            const dodajButton = new ButtonBuilder()
                .setCustomId('queue_cmd_dodaj')
                .setLabel('Dodaj brakujący wynik')
                .setEmoji('➕')
                .setStyle(ButtonStyle.Success);

            const modyfikujButton = new ButtonBuilder()
                .setCustomId('queue_cmd_modyfikuj')
                .setLabel('Modyfikuj wynik')
                .setEmoji('✏️')
                .setStyle(ButtonStyle.Success);

            const imgButton = new ButtonBuilder()
                .setCustomId('queue_cmd_img')
                .setLabel('Dodaj zdjęcie rankingu')
                .setEmoji('📷')
                .setStyle(ButtonStyle.Success);

            const clanStatusButton = new ButtonBuilder()
                .setCustomId('queue_cmd_clan_status')
                .setLabel('Status klanów')
                .setEmoji('📊')
                .setStyle(ButtonStyle.Primary);

            const clanProgresButton = new ButtonBuilder()
                .setCustomId('queue_cmd_clan_progres')
                .setLabel('Progres klanów')
                .setEmoji('📈')
                .setStyle(ButtonStyle.Primary);

            const wynikiButton = new ButtonBuilder()
                .setCustomId('queue_cmd_wyniki')
                .setLabel('Wyniki klanów')
                .setEmoji('🏆')
                .setStyle(ButtonStyle.Primary);

            const wdupieButton = new ButtonBuilder()
                .setCustomId('queue_cmd_player_raport')
                .setLabel('Gracze o potencjalnie wysokim poziomie wypalenia')
                .setEmoji('🔍')
                .setStyle(ButtonStyle.Danger);

            const row1 = new ActionRowBuilder()
                .addComponents(faza1Button, faza2Button, remindButton, punishButton, leaveQueueButton);

            const row2 = new ActionRowBuilder()
                .addComponents(dodajButton, modyfikujButton, imgButton);

            const row3 = new ActionRowBuilder()
                .addComponents(clanStatusButton, clanProgresButton, wynikiButton);

            const row4 = new ActionRowBuilder()
                .addComponents(wdupieButton);

            if (queueMessage) {
                // Zaktualizuj istniejący embed
                await queueMessage.edit({ embeds: [embed], components: [row1, row2, row3, row4] });
                this.queueMessageId = queueMessage.id;
                logger.info('[OCR-QUEUE] ✅ Zaktualizowano istniejący embed kolejki (ID: ' + queueMessage.id + ')');
            } else {
                // Wyślij nowy embed jako pierwszą wiadomość
                const message = await channel.send({ embeds: [embed], components: [row1, row2, row3, row4] });
                this.queueMessageId = message.id;
                logger.info('[OCR-QUEUE] ✅ Utworzono nowy embed kolejki (ID: ' + message.id + ')');
            }

            logger.info('[OCR-QUEUE] ✅ Inicjalizacja wyświetlania kolejki zakończona');
        } catch (error) {
            logger.error('[OCR-QUEUE] ❌ Błąd inicjalizacji wyświetlania kolejki:', error);
        }
    }

    // ==================== SYSTEM KOLEJKOWANIA OCR ====================

    /**
     * Sprawdza czy użytkownik ma rezerwację OCR
     */
    hasReservation(guildId, userId) {
        if (!this.queueReservation.has(guildId)) {
            return false;
        }
        const reservation = this.queueReservation.get(guildId);
        return reservation.userId === userId;
    }

    /**
     * Sprawdza czy ktoś obecnie używa OCR
     */
    isOCRActive(guildId) {
        return this.activeProcessing.has(guildId);
    }

    /**
     * Pobiera info kto obecnie używa OCR
     */
    getActiveOCRUser(guildId) {
        return this.activeProcessing.get(guildId);
    }

    /**
     * Rozpoczyna sesję OCR dla użytkownika
     */
    /**
     * Określa timeout dla sesji na podstawie komendy
     */
    getSessionTimeout(commandName) {
        // Wszystkie sesje OCR: 15 minut (maksymalny czas)
        // Timeout kolejki (rezerwacji) pozostaje 3 minuty
        return 15 * 60 * 1000; // 15 minut dla wszystkich komend
    }

    async startOCRSession(guildId, userId, commandName) {
        // Usuń rezerwację jeśli istnieje
        if (this.queueReservation.has(guildId)) {
            const reservation = this.queueReservation.get(guildId);

            // Zatrzymaj ghost ping
            if (reservation.ghostPingInterval) {
                clearInterval(reservation.ghostPingInterval);
                logger.info(`[OCR-QUEUE] ⏹️ Zatrzymano ghost ping - użytkownik rozpoczął sesję`);
            }

            // Usuń ostatnią wiadomość ghost ping
            if (reservation.ghostPingMessageId) {
                try {
                    const channel = await this.client.channels.fetch(this.queueChannelId);
                    const message = await channel.messages.fetch(reservation.ghostPingMessageId);
                    await message.delete();
                    logger.info(`[OCR-QUEUE] 🗑️ Usunięto ostatnią wiadomość ghost ping - sesja rozpoczęta`);
                } catch (error) {
                    // Ignoruj błąd - wiadomość już może być usunięta
                }
            }

            if (reservation.timeout) {
                clearTimeout(reservation.timeout);
            }
            this.queueReservation.delete(guildId);
        }

        // Usuń z kolejki jeśli tam jest
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);
            const index = queue.findIndex(item => item.userId === userId);
            if (index !== -1) {
                queue.splice(index, 1);
            }
        }

        // Określ timeout na podstawie komendy
        const timeoutDuration = this.getSessionTimeout(commandName);
        const expiresAt = Date.now() + timeoutDuration;

        // Ustaw timeout który wywoła wygaśnięcie sesji
        const timeout = setTimeout(async () => {
            logger.warn(`[OCR-QUEUE] ⏰ Sesja OCR wygasła dla ${userId} (${commandName})`);
            await this.expireOCRSession(guildId, userId);
        }, timeoutDuration);

        this.activeProcessing.set(guildId, { userId, commandName, expiresAt, timeout });
        const minutes = timeoutDuration / (60 * 1000);
        logger.info(`[OCR-QUEUE] 🔒 Użytkownik ${userId} rozpoczął ${commandName} (timeout: ${minutes} min)`);

        // Aktualizuj wyświetlanie kolejki
        await this.updateQueueDisplay(guildId);
    }

    /**
     * Odnawia timeout sesji OCR (wywoływane przy każdym kliknięciu przycisku)
     */
    async refreshOCRSession(guildId, userId) {
        const active = this.activeProcessing.get(guildId);
        if (!active || active.userId !== userId) {
            return; // Nie ta sesja lub sesja nie istnieje
        }

        // Wyczyść stary timeout
        if (active.timeout) {
            clearTimeout(active.timeout);
        }

        // Określ timeout na podstawie komendy
        const timeoutDuration = this.getSessionTimeout(active.commandName);
        const expiresAt = Date.now() + timeoutDuration;

        // Ustaw nowy timeout
        const timeout = setTimeout(async () => {
            logger.warn(`[OCR-QUEUE] ⏰ Sesja OCR wygasła dla ${userId} (${active.commandName})`);
            await this.expireOCRSession(guildId, userId);
        }, timeoutDuration);

        // Zaktualizuj sesję z nowym timeoutem
        active.expiresAt = expiresAt;
        active.timeout = timeout;
        this.activeProcessing.set(guildId, active);

        const minutes = timeoutDuration / (60 * 1000);
        logger.info(`[OCR-QUEUE] 🔄 Odświeżono timeout dla ${userId} (${active.commandName}, +${minutes} min)`);

        // Aktualizuj wyświetlanie kolejki (odświeża timestamp w embedzie)
        await this.updateQueueDisplay(guildId);
    }

    /**
     * Kończy sesję OCR i powiadamia następną osobę w kolejce
     */
    async endOCRSession(guildId, userId, immediate = false) {
        const active = this.activeProcessing.get(guildId);
        if (!active || active.userId !== userId) {
            return; // Nie ten użytkownik
        }

        // Wyczyść timeout jeśli istnieje
        if (active.timeout) {
            clearTimeout(active.timeout);
        }

        // Usuń z aktywnego przetwarzania NATYCHMIAST (zapobiega wielokrotnym kliknięciom)
        this.activeProcessing.delete(guildId);
        logger.info(`[OCR-QUEUE] 🔓 Użytkownik ${userId} zakończył OCR`);

        // Wyczyść osierocone pliki temp z processed_ocr/
        await cleanupOrphanedTempFiles(this.processedDir, 10 * 60 * 1000, logger);

        // Opóźnienie przed czyszczeniem kanału i powiadomieniem następnej osoby
        const delay = immediate ? 0 : 5000; // 5 sekund jeśli nie immediate

        if (delay > 0) {
            logger.info(`[OCR-QUEUE] ⏳ Oczekiwanie 5 sekund przed czyszczeniem kanału kolejki...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            logger.info(`[OCR-QUEUE] 🧹 Czyszczenie kanału i powiadamianie kolejnej osoby...`);
        }

        // Wyczyść kanał kolejki (usuń wszystkie wiadomości oprócz pierwszej z embedem)
        await this.cleanupQueueChannelMessages();

        // Aktualizuj wyświetlanie kolejki
        await this.updateQueueDisplay(guildId);

        // Sprawdź czy są osoby w kolejce
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);

            if (queue.length > 0) {
                // Pobierz pierwszą osobę z kolejki
                const nextPerson = queue[0];
                logger.info(`[OCR-QUEUE] 📢 Następna osoba: ${nextPerson.userId} (${nextPerson.commandName})`);

                // Stwórz rezerwację na 3 minuty
                await this.createOCRReservation(guildId, nextPerson.userId, nextPerson.commandName);

                // WYŁĄCZONE: Powiadamianie pozostałych osób o zmianie pozycji
            } else {
                this.waitingQueue.delete(guildId);
            }
        }
    }

    /**
     * Wygasa aktywną sesję OCR (timeout 15 minut)
     */
    async expireOCRSession(guildId, userId) {
        const active = this.activeProcessing.get(guildId);

        // Sprawdź czy to nadal ta sama sesja
        if (!active || active.userId !== userId) {
            return; // Sesja już zakończona lub inna osoba
        }

        // Usuń z aktywnego przetwarzania
        this.activeProcessing.delete(guildId);
        logger.info(`[OCR-QUEUE] ⏰ Sesja OCR wygasła i została usunięta dla ${userId}`);

        // Wyczyść osierocone pliki temp z processed_ocr/
        await cleanupOrphanedTempFiles(this.processedDir, 10 * 60 * 1000, logger);

        // Zatrzymaj ghost pingi i wyczyść sesje remind/punish/phase
        // REMINDER
        if (this.reminderService) {
            const reminderSession = this.reminderService.getSessionByUserId(userId);
            if (reminderSession) {
                stopGhostPing(reminderSession);
                await this.reminderService.cleanupSession(reminderSession.sessionId);
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono sesję /remind dla ${userId} (timeout)`);
            }
        }

        // PUNISHMENT
        if (this.punishmentService) {
            const punishSession = this.punishmentService.getSessionByUserId(userId);
            if (punishSession) {
                stopGhostPing(punishSession);
                await this.punishmentService.cleanupSession(punishSession.sessionId);
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono sesję /punish dla ${userId} (timeout)`);
            }
        }

        // PHASE (faza1/faza2)
        if (this.phaseService) {
            const phaseSession = this.phaseService.getSessionByUserId(userId);
            if (phaseSession) {
                stopGhostPing(phaseSession);
                await this.phaseService.cleanupSession(phaseSession.sessionId);
                logger.info(`[OCR-QUEUE] 🧹 Wyczyszczono sesję phase dla ${userId} (timeout)`);
            }
        }

        // Powiadom użytkownika
        try {
            if (!this.client) return;
            const user = await this.client.users.fetch(userId);
            const timeoutMinutes = this.getSessionTimeout(active.commandName) / (60 * 1000);
            await user.send({
                embeds: [new (require('discord.js')).EmbedBuilder()
                    .setTitle('⏰ Sesja wygasła')
                    .setDescription(`Twoja sesja OCR (\`${active.commandName}\`) wygasła z powodu braku aktywności (${timeoutMinutes} min).\n\nMożesz użyć komendy ponownie, aby rozpocząć nową sesję.`)
                    .setColor('#FF0000')
                    .setTimestamp()
                ]
            });
        } catch (error) {
            logger.error(`[OCR-QUEUE] ❌ Błąd powiadomienia o wygasłej sesji:`, error.message);
        }

        // Wyczyść kanał kolejki
        await this.cleanupQueueChannelMessages();

        // Aktualizuj wyświetlanie kolejki
        await this.updateQueueDisplay(guildId);

        // Sprawdź czy są osoby w kolejce i powiadom następną
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);

            if (queue.length > 0) {
                const nextPerson = queue[0];
                logger.info(`[OCR-QUEUE] 📢 Następna osoba po wygaśnięciu: ${nextPerson.userId} (${nextPerson.commandName})`);

                // Stwórz rezerwację na 3 minuty
                await this.createOCRReservation(guildId, nextPerson.userId, nextPerson.commandName);
            } else {
                this.waitingQueue.delete(guildId);
            }
        }
    }

    /**
     * Sprawdza czy kolejka OCR jest pusta
     */
    isQueueEmpty(guildId) {
        if (!this.waitingQueue.has(guildId)) {
            return true;
        }
        const queue = this.waitingQueue.get(guildId);
        return queue.length === 0;
    }

    /**
     * Dodaje użytkownika do kolejki OCR
     */
    async addToOCRQueue(guildId, userId, commandName) {
        if (!this.waitingQueue.has(guildId)) {
            this.waitingQueue.set(guildId, []);
        }

        const queue = this.waitingQueue.get(guildId);

        // Sprawdź czy już jest w kolejce
        if (queue.find(item => item.userId === userId)) {
            return { position: queue.findIndex(item => item.userId === userId) + 1 };
        }

        queue.push({ userId, addedAt: Date.now(), commandName });
        const position = queue.length;

        logger.info(`[OCR-QUEUE] ➕ ${userId} dodany do kolejki OCR (pozycja: ${position}, komenda: ${commandName})`);

        // Aktualizuj wyświetlanie kolejki
        await this.updateQueueDisplay(guildId);

        return { position };
    }

    /**
     * Tworzy rezerwację OCR dla pierwszej osoby w kolejce
     */
    async createOCRReservation(guildId, userId, commandName) {
        // Wyczyść poprzednią rezerwację jeśli istnieje
        if (this.queueReservation.has(guildId)) {
            const oldReservation = this.queueReservation.get(guildId);
            if (oldReservation.timeout) {
                clearTimeout(oldReservation.timeout);
            }
            // Zatrzymaj ghost ping z poprzedniej rezerwacji
            if (oldReservation.ghostPingInterval) {
                clearInterval(oldReservation.ghostPingInterval);
            }
            // Usuń ostatnią wiadomość ghost ping
            if (oldReservation.ghostPingMessageId) {
                try {
                    const channel = await this.client.channels.fetch(this.queueChannelId);
                    const message = await channel.messages.fetch(oldReservation.ghostPingMessageId);
                    await message.delete();
                } catch (error) {
                    // Ignoruj błąd - wiadomość już może być usunięta
                }
            }
        }

        const expiresAt = Date.now() + (3 * 60 * 1000); // 3 minuty

        const timeout = setTimeout(async () => {
            logger.warn(`[OCR-QUEUE] ⏰ Rezerwacja wygasła dla ${userId}`);
            await this.expireOCRReservation(guildId, userId);
        }, 3 * 60 * 1000);

        // Rozpocznij ghost ping co 30 sekund
        let ghostPingMessageId = null;
        const sendGhostPing = async () => {
            try {
                if (!this.client || !this.queueChannelId) return;

                const channel = await this.client.channels.fetch(this.queueChannelId);
                if (!channel) return;

                // Usuń poprzednią wiadomość ghost ping
                if (ghostPingMessageId) {
                    try {
                        const oldMessage = await channel.messages.fetch(ghostPingMessageId);
                        await oldMessage.delete();
                    } catch (error) {
                        // Ignoruj błąd - wiadomość już może być usunięta
                    }
                }

                // Wyślij nową wiadomość ghost ping
                const message = await channel.send(`<@${userId}> 👋 Twoja kolej! Użyj komendy, w celu przeprowadzenia analizy zdjęć!`);
                ghostPingMessageId = message.id;

                // Aktualizuj ID w rezerwacji (potrzebne dla czyszczenia)
                const reservation = this.queueReservation.get(guildId);
                if (reservation) {
                    reservation.ghostPingMessageId = ghostPingMessageId;
                }

                logger.info(`[OCR-QUEUE] 👻 Wysłano ghost ping do ${userId}`);
            } catch (error) {
                logger.error(`[OCR-QUEUE] ❌ Błąd wysyłania ghost ping:`, error.message);
            }
        };

        // Wyślij pierwszy ghost ping natychmiast
        await sendGhostPing();

        // Rozpocznij interval co 30 sekund
        const ghostPingInterval = setInterval(sendGhostPing, 30 * 1000);

        this.queueReservation.set(guildId, {
            userId,
            expiresAt,
            timeout,
            commandName,
            ghostPingInterval,
            ghostPingMessageId
        });

        // Aktualizuj wyświetlanie kolejki
        await this.updateQueueDisplay(guildId);

        logger.info(`[OCR-QUEUE] ✅ Utworzono rezerwację dla ${userId} z ghost pingiem co 30s`);
    }

    /**
     * Wygasa rezerwację i przechodzi do następnej osoby
     */
    async expireOCRReservation(guildId, userId) {
        // Zatrzymaj ghost ping PRZED usunięciem rezerwacji
        const reservation = this.queueReservation.get(guildId);
        if (reservation) {
            if (reservation.ghostPingInterval) {
                clearInterval(reservation.ghostPingInterval);
                logger.info(`[OCR-QUEUE] ⏹️ Zatrzymano ghost ping dla ${userId}`);
            }
            // Usuń ostatnią wiadomość ghost ping
            if (reservation.ghostPingMessageId) {
                try {
                    const channel = await this.client.channels.fetch(this.queueChannelId);
                    const message = await channel.messages.fetch(reservation.ghostPingMessageId);
                    await message.delete();
                    logger.info(`[OCR-QUEUE] 🗑️ Usunięto ostatnią wiadomość ghost ping`);
                } catch (error) {
                    // Ignoruj błąd - wiadomość już może być usunięta
                }
            }
        }

        this.queueReservation.delete(guildId);

        // Usuń z kolejki
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);
            const index = queue.findIndex(item => item.userId === userId);

            if (index !== -1) {
                queue.splice(index, 1);
                logger.info(`[OCR-QUEUE] ➖ ${userId} usunięty z kolejki (timeout)`);

                // Przejdź do następnej osoby
                if (queue.length > 0) {
                    const nextPerson = queue[0];
                    await this.createOCRReservation(guildId, nextPerson.userId, nextPerson.commandName);
                } else {
                    this.waitingQueue.delete(guildId);
                }
            }
        }

        // KLUCZOWE: Aktualizuj wyświetlanie NA KOŃCU, po usunięciu użytkownika z kolejki
        // Dzięki temu jeśli był jedyny w kolejce, embed pokaże pustą kolejkę
        await this.updateQueueDisplay(guildId);
    }

    /**
     * Powiadamia użytkownika o pozycji w kolejce
     */
    async notifyQueuePosition(guildId, userId, position, commandName) {
        try {
            if (!this.client) return;

            const queue = this.waitingQueue.get(guildId) || [];
            const peopleAhead = queue.slice(0, position - 1);

            let description = `Ktoś obecnie używa komendy OCR.\n\n`;
            description += `📊 **Twoja pozycja w kolejce:** ${position}\n`;
            description += `👥 **Łącznie osób w kolejce:** ${queue.length}\n\n`;

            if (peopleAhead.length > 0) {
                description += `⏳ **Osoby przed Tobą:**\n`;
                for (let i = 0; i < peopleAhead.length; i++) {
                    const person = peopleAhead[i];
                    const member = await this.client.users.fetch(person.userId);
                    description += `${i + 1}. ${member.tag} - \`${person.commandName}\`\n`;
                }
            }

            description += `\n💡 **Dostaniesz powiadomienie gdy będzie Twoja kolej.**`;

            const user = await this.client.users.fetch(userId);
            await user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('⏳ Jesteś w kolejce OCR')
                    .setDescription(description)
                    .setColor('#FFA500')
                    .setTimestamp()
                ]
            });
        } catch (error) {
            logger.error(`[OCR-QUEUE] ❌ Błąd powiadomienia o kolejce:`, error.message);
        }
    }

    /**
     * Usuwa użytkownika z kolejki (anulowanie)
     */
    async removeFromOCRQueue(guildId, userId) {
        // Usuń z rezerwacji
        if (this.queueReservation.has(guildId)) {
            const reservation = this.queueReservation.get(guildId);
            if (reservation.userId === userId) {
                if (reservation.timeout) {
                    clearTimeout(reservation.timeout);
                }
                this.queueReservation.delete(guildId);
                logger.info(`[OCR-QUEUE] ➖ Usunięto rezerwację dla ${userId}`);

                // Aktualizuj wyświetlanie kolejki
                await this.updateQueueDisplay(guildId);
                return true;
            }
        }

        // Usuń z kolejki
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);
            const index = queue.findIndex(item => item.userId === userId);
            if (index !== -1) {
                queue.splice(index, 1);
                logger.info(`[OCR-QUEUE] ➖ Usunięto ${userId} z kolejki OCR`);

                if (queue.length === 0) {
                    this.waitingQueue.delete(guildId);
                }

                // Aktualizuj wyświetlanie kolejki
                await this.updateQueueDisplay(guildId);
                return true;
            }
        }

        return false;
    }

}

module.exports = OCRService;