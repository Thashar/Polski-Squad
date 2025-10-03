const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { calculateNameSimilarity } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');
const { saveProcessedImage } = require('../../utils/ocrFileUtils');

const logger = createBotLogger('StalkerLME');

class OCRService {
    constructor(config) {
        this.config = config;
        this.tempDir = this.config.ocr.tempDir || './StalkerLME/temp';
        this.processedDir = this.config.ocr.processedDir || './StalkerLME/processed';
    }

    async initializeOCR() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            if (this.config.ocr.saveProcessedImages) {
                await fs.mkdir(this.processedDir, { recursive: true });
            }
            logger.info('[OCR] ✅ Serwis OCR zainicjalizowany');
        } catch (error) {
            logger.error('[OCR] ❌ Błąd inicjalizacji OCR:', error);
        }
    }

    async processImage(attachment) {
        try {
            logger.info('Rozpoczęcie analizy OCR');
            logger.info(`📷 Przetwarzanie obrazu: ${attachment.url}`);
            
            const response = await fetch(attachment.url);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            const processedBuffer = await this.processImageWithSharp(buffer);
            
            logger.info('Uruchamianie OCR');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                tessedit_char_whitelist: this.config.ocr.polishAlphabet
            });
            
            logger.info('🔤 Odczytany tekst z OCR:');
            const textLines = text.split('\n').filter(line => line.trim().length > 0);
            textLines.forEach((line, index) => {
                logger.info(`${index + 1}: ${line.trim()}`);
            });
            
            return text;
        } catch (error) {
            logger.error('Błąd OCR');
            logger.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
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
                await fs.unlink(tempOutputPath).catch(() => {});
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
            return resultNicks;
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
            const members = await guild.members.fetch();
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
            const members = await guild.members.fetch();
            logger.info(`👥 Znaleziono ${members.size} członków serwera`);
            
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
            
            
            const members = await guild.members.fetch();
            const roleMembers = [];
            
            for (const [userId, member] of members) {
                if (member.roles.cache.has(userRoleId)) {
                    roleMembers.push({
                        userId: userId,
                        member: member,
                        displayName: member.displayName
                    });
                }
            }
            
            logger.info(`👥 Znaleziono ${roleMembers.length} członków z rolą ${userRoleId}`);
            return roleMembers;
        } catch (error) {
            logger.error('❌ Błąd pobierania nicków z roli:', error);
            return [];
        }
    }


    calculateLineSimilarity(line, nick) {
        const lineLower = line.toLowerCase().replace(/[^a-z0-9]/g, ''); // Usuń wszystkie znaki specjalne
        const nickLower = nick.toLowerCase().replace(/[^a-z0-9]/g, '');
        
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

    async cleanupTempFiles() {
        try {
            const files = await fs.readdir(this.tempDir);

            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                const stats = await fs.stat(filePath);

                const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);

                if (ageInHours > 1) {
                    await fs.unlink(filePath);
                    logger.info(`[OCR] 🗑️ Usunięto stary plik tymczasowy: ${file}`);
                }
            }
        } catch (error) {
            logger.error('[OCR] ❌ Błąd czyszczenia plików tymczasowych:', error);
        }
    }

    /**
     * Wyciąga wszystkich graczy z ich wynikami (nie tylko z zerem)
     * Używane dla komendy /faza1
     */
    async extractAllPlayersWithScores(text, guild = null, requestingMember = null) {
        try {
            logger.info('[PHASE1] 🎯 Rozpoczynam ekstrakcję wszystkich graczy z wynikami...');

            if (!guild || !requestingMember) {
                logger.error('[PHASE1] ❌ Brak guild lub requestingMember - nie można kontynuować');
                return [];
            }

            // Pobierz nicki z odpowiedniej roli
            const roleNicks = await this.getRoleNicks(guild, requestingMember);
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
                    let finalScore = null;

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
                        }
                    }

                    // Tylko jeśli udało się wyciągnąć wynik
                    if (finalScore !== null) {
                        processedNicks.add(bestMatch.displayName);

                        playersWithScores.push({
                            nick: bestMatch.displayName,
                            score: finalScore
                        });

                        logger.info(`[PHASE1] ✅ "${bestMatch.displayName}" → ${finalScore} punktów`);
                    }
                }
            }

            logger.info(`[PHASE1] 📊 Znaleziono ${playersWithScores.length} graczy z wynikami`);
            return playersWithScores;

        } catch (error) {
            logger.error('[PHASE1] ❌ Błąd ekstrakcji graczy z wynikami:', error);
            return [];
        }
    }

}

module.exports = OCRService;