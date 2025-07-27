const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { calculateNameSimilarity } = require('../utils/helpers');
const { createBotLogger } = require('../../utils/consoleLogger');

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
            
            logger.info('Przetwarzanie obrazu - inwersja białego tekstu na czarny');
            logger.info('🎨 Rozpoczynam przetwarzanie obrazu z inwersją...');
            const processedBuffer = await this.processImageWithSharp(buffer);
            logger.info('✅ Przetwarzanie obrazu z inwersją zakończone');
            
            logger.info('Uruchamianie OCR');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                tessedit_char_whitelist: this.config.ocr.polishAlphabet
            });
            
            logger.info('Pełny tekst z OCR');
            logger.info('🔤 Odczytany tekst:');
            logger.info('Początek tekstu:');
            logger.info(text);
            logger.info('Koniec tekstu');
            
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
            
            // Ścieżka do zapisania przetworzonego obrazu
            const timestamp = Date.now();
            const outputPath = path.join(this.processedDir, `stalker_processed_${timestamp}.png`);
            
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
                await processedBuffer.toFile(outputPath);
                logger.info(`💾 Zapisano przetworzony obraz: ${outputPath}`);
                
                // Wywołaj czyszczenie starych plików
                await this.cleanupProcessedImages();
            }
            
            // Zwróć buffer do OCR
            const buffer = await processedBuffer.toBuffer();
            
            logger.info(`✅ Obraz przetworzony - upscale: ${this.config.ocr.imageProcessing.upscale}x, gamma: ${this.config.ocr.imageProcessing.gamma}, median: ${this.config.ocr.imageProcessing.median}, blur: ${this.config.ocr.imageProcessing.blur} + zaawansowane filtry dla czarnego tekstu`);
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
            
            // Oblicz średnią długość linii
            const avgLineLength = lines.reduce((sum, line) => sum + line.trim().length, 0) / lines.length;
            logger.info(`📏 Średnia długość linii: ${avgLineLength.toFixed(1)} znaków`);
            
            // Filtruj linie krótsze niż średnia
            const validLines = lines.filter(line => line.trim().length >= avgLineLength);
            logger.info(`📋 Analizuję ${validLines.length}/${lines.length} linii (dłuższe niż średnia)`);
            
            const confirmedPlayers = [];
            const processedNicks = new Set(); // Śledzenie już przetworzonych nicków z zerem
            
            // Krok 3: Dla każdej linii znajdź najlepiej dopasowany nick z roli
            for (let i = 0; i < validLines.length; i++) {
                const line = validLines[i];
                logger.info(`🔍 Linia ${i + 1}: "${line.trim()}"`);
                
                // Znajdź najlepsze dopasowanie ze wszystkich nicków z roli
                let bestMatch = null;
                let bestSimilarity = 0;
                
                for (const roleNick of roleNicks) {
                    const similarity = this.calculateLineSimilarity(line, roleNick.displayName);
                    
                    if (similarity >= 0.7 && similarity > bestSimilarity) {
                        bestSimilarity = similarity;
                        bestMatch = roleNick;
                    }
                }
                
                if (bestMatch) {
                    logger.info(`   ✅ Najlepsze dopasowanie: "${bestMatch.displayName}" (${(bestSimilarity * 100).toFixed(1)}% podobieństwa)`);
                    
                    // Krok 4: Sprawdź koniec linii za nickiem dla wyniku
                    let endResult = this.analyzeLineEnd(line, bestMatch.displayName);
                    logger.info(`   📊 Analiza za nickiem: ${endResult.type} (wartość: "${endResult.value}")`);
                    
                    // Jeśli nick ma 10+ liter i nie znaleziono wyniku/zera w tej linii, sprawdź następną linię
                    if (bestMatch.displayName.length >= 10 && endResult.type === 'unknown') {
                        // Znajdź rzeczywistą następną linię w oryginalnych liniach, nie w filtrowanych
                        const currentLineText = line.trim();
                        const allLines = text.split('\n').filter(line => line.trim().length > 0);
                        const currentLineIndex = allLines.findIndex(l => l.trim() === currentLineText);
                        
                        if (currentLineIndex !== -1 && currentLineIndex + 1 < allLines.length) {
                            const nextLine = allLines[currentLineIndex + 1];
                            logger.info(`   🔍 Nick długi (${bestMatch.displayName.length} znaków), sprawdzam rzeczywistą następną linię: "${nextLine.trim()}"`);
                            
                            const nextEndResult = this.analyzeLineEnd(nextLine, null); // W następnej linii nie szukamy za nickiem
                            logger.info(`   📊 Analiza następnej linii: ${nextEndResult.type} (wartość: "${nextEndResult.value}")`);
                            
                            if (nextEndResult.type !== 'unknown') {
                                endResult = nextEndResult;
                                logger.info(`   ✅ Użyto wyniku z następnej linii`);
                            }
                        }
                    }
                    
                    if (endResult.type === 'zero' || endResult.type === 'unknown') {
                        // Sprawdź czy ten nick z zerem już został przetworzony
                        if (processedNicks.has(bestMatch.displayName)) {
                            logger.info(`   ⚠️ DUPLIKAT - nick "${bestMatch.displayName}" z zerem już został przetworzony, pomijam`);
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
                        if (endResult.type === 'zero') {
                            logger.info(`   🎉 POTWIERDZONY zero (wzorzec): ${bestMatch.displayName}${hasUncertainty ? ' [NIEPEWNY ©]' : ''}`);
                        } else {
                            logger.info(`   🎉 POTWIERDZONY zero (brak wyniku): ${bestMatch.displayName}${hasUncertainty ? ' [NIEPEWNY ©]' : ''}`);
                        }
                    } else if (endResult.type === 'negative') {
                        logger.info(`   ❌ Wynik negatywny: ${bestMatch.displayName} (${endResult.value})`);
                    }
                } else {
                    logger.info(`   ❌ Brak dopasowania powyżej 70% podobieństwa`);
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
            /\s+zo\s+/g, /\s+zo$/g, /^zo\s+/g
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
            
            logger.info(`🎯 Pobieranie nicków z roli: ${userRoleId}`);
            
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
        
        // Oblicz podobieństwo na podstawie kolejnych znaków z nicku
        return this.calculateOrderedSimilarity(lineLower, nickLower);
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
            
            // W nawiasach okrągłych
            /^\(0\)$/,               // (0)
            /^\(1\)$/,               // (1)
            /^\(9\)$/,               // (9)
            /^\(o\)$/,               // (o)
            
            // W nawiasach kwadratowych
            /^\[0\]$/,               // [0]
            /^\[1\]$/,               // [1]
            /^\[9\]$/,               // [9]
            /^\[o\]$/,               // [o]
            
            // Z nawiasem na końcu
            /^0\)$/,                 // 0)
            /^1\)$/,                 // 1)
            /^9\)$/,                 // 9)
            /^o\)$/,                 // o)
            
            // Z otwartym nawiasem okrągłym na początku
            /^\(0$/,                 // (0
            /^\(1$/,                 // (1
            /^\(9$/,                 // (9
            /^\(o$/,                 // (o
            
            // Z otwartym nawiasem kwadratowym na początku
            /^\[0$/,                 // [0
            /^\[1$/,                 // [1
            /^\[9$/,                 // [9
            /^\[o$/,                 // [o
            
            // Z zamkniętym nawiasem kwadratowym na końcu
            /^0\]$/,                 // 0]
            /^1\]$/,                 // 1]
            /^9\]$/,                 // 9]
            /^o\]$/,                 // o]
            
            // Dodatkowe wzorce
            /^zo$/                   // zo
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

    async cleanupProcessedImages() {
        try {
            if (!this.config.ocr.saveProcessedImages) {
                return;
            }

            const files = await fs.readdir(this.processedDir);
            const processedFiles = files.filter(file => file.startsWith('stalker_processed_') && file.endsWith('.png'));
            
            if (processedFiles.length <= this.config.ocr.maxProcessedFiles) {
                return;
            }

            // Sortuj pliki według czasu modyfikacji (najstarsze pierwsze)
            const filesWithStats = await Promise.all(
                processedFiles.map(async (file) => {
                    const filePath = path.join(this.processedDir, file);
                    const stats = await fs.stat(filePath);
                    return { file, filePath, mtime: stats.mtime };
                })
            );

            filesWithStats.sort((a, b) => a.mtime - b.mtime);

            // Usuń najstarsze pliki, pozostawiając maksymalną liczbę
            const filesToDelete = filesWithStats.slice(0, filesWithStats.length - this.config.ocr.maxProcessedFiles);
            
            for (const fileInfo of filesToDelete) {
                await fs.unlink(fileInfo.filePath);
                logger.info(`🗑️ Usunięto stary przetworzony obraz: ${fileInfo.file}`);
            }

            if (filesToDelete.length > 0) {
                logger.info(`🧹 Wyczyszczono ${filesToDelete.length} starych przetworzonych obrazów, pozostało ${this.config.ocr.maxProcessedFiles}`);
            }
        } catch (error) {
            logger.error('❌ Błąd czyszczenia przetworzonych obrazów:', error);
        }
    }
}

module.exports = OCRService;