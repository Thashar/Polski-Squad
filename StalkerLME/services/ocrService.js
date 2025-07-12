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
        this.tempDir = './StalkerLME/temp';
    }

    async initializeOCR() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
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
            
            logger.info('Konwersja na czarno-biały');
            logger.info('🎨 Rozpoczynam przetwarzanie obrazu...');
            const processedBuffer = await this.processImageWithSharp(buffer);
            logger.info('✅ Przetwarzanie obrazu zakończone');
            
            logger.info('Uruchamianie OCR');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        logger.info(`📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
                    }
                },
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
            // Przetwarzanie obrazu z fokusem na biały tekst
            const processedBuffer = await sharp(imageBuffer)
                .greyscale()
                // Zwiększamy kontrast aby wydobyć biały tekst
                .normalize() // Rozciąga histogram dla lepszego kontrastu
                .linear(1.5, -50) // Zwiększamy kontrast i zmniejszamy jasność tła
                // Threshold - wszystko poza białym tekstem staje się czarne
                .threshold(200) // Wyższy próg - tylko bardzo jasne piksele (biały tekst) pozostają białe
                .png()
                .toBuffer();
            
            logger.info('✅ Obraz przetworzony - biały tekst na czarnym tle');
            return processedBuffer;
        } catch (error) {
            logger.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        }
    }

    async extractPlayersFromText(text, guild = null) {
        try {
            logger.info('Analiza tekstu');
            logger.info('🎯 Nowa logika szukania graczy z wynikiem 0...');
            
            const lines = text.split('\n').filter(line => line.trim().length > 0);
            const confirmedPlayers = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                
                // Pomijaj pierwsze 3 i ostatnie 3 linie
                if (i < 3 || i >= lines.length - 3) {
                    logger.info(`⏭️ Pomijam linię ${i + 1} (pierwsze/ostatnie 3): "${line.trim()}"`);
                    continue;
                }
                
                logger.info(`🔍 Analizuję linię ${i + 1}: "${line.trim()}"`);
                
                // Krok 1: Sprawdź czy linia zawiera zero
                const hasZero = this.hasZeroScore(line);
                logger.info(`   Zero w linii: ${hasZero ? '✅' : '❌'}`);
                
                if (hasZero) {
                    // Krok 2: Znajdź potencjalne nicki (pomijając wzorce zero)
                    const zeroElements = this.getZeroElementsFromLine(line);
                    const words = line.split(/\s+/);
                    const playerCandidates = words.filter(word => {
                        return !zeroElements.includes(word) && this.isLikelyPlayerName(word);
                    });
                    
                    if (playerCandidates.length > 0) {
                        const detectedNick = playerCandidates.reduce((longest, current) => 
                            current.length > longest.length ? current : longest
                        );
                        logger.info(`   🎯 Wykryty nick: "${detectedNick}"`);
                        
                        // Krok 3: Sprawdź podobieństwo z użytkownikami na serwerze (jeśli mamy guild)
                        if (guild) {
                            const similarUser = await this.findSimilarUserOnServer(guild, detectedNick);
                            if (similarUser) {
                                logger.info(`   ✅ Znaleziono podobnego użytkownika: ${similarUser.displayName} (${(similarUser.similarity * 100).toFixed(1)}%)`);
                                
                                // Krok 4: Szukaj dodatkowego potwierdzenia zera
                                const additionalZeroConfirmed = await this.confirmZeroWithAdditionalCheck(detectedNick, line, lines, i);
                                
                                if (additionalZeroConfirmed) {
                                    confirmedPlayers.push({
                                        detectedNick: detectedNick,
                                        user: similarUser,
                                        confirmed: true
                                    });
                                    logger.info(`   🎉 POTWIERDZONY: ${detectedNick} -> ${similarUser.displayName}`);
                                } else {
                                    logger.info(`   ⚠️ Brak dodatkowego potwierdzenia zera dla: ${detectedNick}`);
                                }
                            } else {
                                logger.info(`   ❌ Brak podobnego użytkownika na serwerze dla: ${detectedNick}`);
                            }
                        } else {
                            // Bez guild - dodaj bezpośrednio
                            confirmedPlayers.push({
                                detectedNick: detectedNick,
                                user: null,
                                confirmed: true
                            });
                            logger.info(`   ➕ Dodano bez sprawdzania serwera: ${detectedNick}`);
                        }
                    } else {
                        logger.info(`   ⚠️ Wszystkie słowa to wzorce zero: ${line.trim()}`);
                    }
                }
            }
            
            const resultNicks = confirmedPlayers.map(p => p.detectedNick);
            logger.info(`Końcowy wynik: ${confirmedPlayers.length} potwierdzonych graczy`);
            logger.info(`👥 Lista: ${resultNicks.join(', ')}`);
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
        processedLine = processedLine.replace(/\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\s/g, ' 0 ');  // Pattern single letter with spaces - treated as 0
        processedLine = processedLine.replace(/\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]$/g, ' 0');  // Pattern single letter at end - treated as 0
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
            /\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]\s/g, /\s[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ]$/g,
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
}

module.exports = OCRService;