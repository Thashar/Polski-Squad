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

    async extractPlayersFromText(text, guild = null, requestingMember = null) {
        try {
            logger.info('Analiza tekstu');
            logger.info('🎯 Nowa logika: najpierw dopasuj nicki z roli, potem sprawdź wyniki...');

            if (!guild || !requestingMember) {
                logger.error('❌ Brak guild lub requestingMember - nie można kontynuować');
                return [];
            }

            // Krok 1: Określ rolę użytkownika i pobierz członków z tej roli
            const userRole = this.getUserRole(requestingMember);
            if (!userRole) {
                logger.error('❌ Użytkownik nie ma żadnej z ról TARGET (0, 1, 2, main)');
                return [];
            }

            const roleMembers = await this.getMembersFromRole(guild, userRole);
            if (roleMembers.length === 0) {
                logger.error(`❌ Nie znaleziono członków w roli: ${userRole}`);
                return [];
            }

            logger.info(`🎯 Rola użytkownika: ${userRole}`);
            logger.info(`👥 Znaleziono ${roleMembers.length} członków w roli`);
            logger.info(`📝 Nicki w roli: ${roleMembers.map(m => m.displayName).join(', ')}`);

            const lines = text.split('\n').filter(line => line.trim().length > 0);
            const confirmedPlayers = [];

            // Krok 2: Analizuj każdą linię w poszukiwaniu nicków
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Pomijaj pierwsze 2 linie
                if (i < 2) {
                    logger.info(`⏭️ Pomijam linię ${i + 1} (pierwsze 2): "${line.trim()}"`);
                    continue;
                }

                logger.info(`🔍 Analizuję linię ${i + 1}: "${line.trim()}"`);

                // Krok 3: Znajdź słowa w linii i dopasuj do nicków z roli
                const words = line.split(/\s+/).filter(word => word.trim().length > 0);
                logger.info(`   📝 Słowa w linii: ${words.join(', ')}`);

                for (const word of words) {
                    // Dopasuj słowo do nicków z roli
                    const matchedMember = this.findBestMemberMatch(word, roleMembers);
                    
                    if (matchedMember) {
                        logger.info(`   ✅ Dopasowano słowo "${word}" do gracza: ${matchedMember.member.displayName} (${(matchedMember.similarity * 100).toFixed(1)}%)`);

                        // Krok 4: Sprawdź wynik dla dopasowanego gracza
                        const scoreResult = await this.checkPlayerScoreNew(word, line, lines, i);
                        
                        // Sprawdź czy gracz już nie został dodany
                        const alreadyAdded = confirmedPlayers.find(p => p.user.userId === matchedMember.member.user.id);
                        if (alreadyAdded) {
                            logger.info(`   ⚠️ Gracz ${matchedMember.member.displayName} już został dodany, pomijam`);
                            continue;
                        }

                        confirmedPlayers.push({
                            detectedNick: word,
                            user: {
                                userId: matchedMember.member.user.id,
                                member: matchedMember.member,
                                displayName: matchedMember.member.displayName,
                                similarity: matchedMember.similarity
                            },
                            confirmed: true,
                            scoreType: scoreResult.scoreType,
                            scoreValue: scoreResult.scoreValue
                        });

                        logger.info(`   🎉 DODANO GRACZA: ${word} -> ${matchedMember.member.displayName} (wynik: ${scoreResult.scoreType} = ${scoreResult.scoreValue})`);
                    }
                }
            }

            const resultNicks = confirmedPlayers.map(p => p.detectedNick);
            const zeroScores = confirmedPlayers.filter(p => p.scoreType === 'zero').length;
            const twoDigitScores = confirmedPlayers.filter(p => p.scoreType === 'two-digit').length;
            const threeDigitScores = confirmedPlayers.filter(p => p.scoreType === 'three-digit').length;

            logger.info(`📊 PODSUMOWANIE ANALIZY OCR:`);
            logger.info(`   🎯 Znalezionych graczy: ${confirmedPlayers.length}`);
            logger.info(`   🔢 Z wynikiem 0: ${zeroScores}`);
            logger.info(`   📊 Z wynikiem 2-cyfrowym: ${twoDigitScores}`);
            logger.info(`   📈 Z wynikiem 3-cyfrowym: ${threeDigitScores}`);
            logger.info(`   👥 Lista: ${resultNicks.join(', ')}`);
            return resultNicks;
        } catch (error) {
            logger.error('Błąd analizy tekstu');
            logger.error('❌ Błąd analizy tekstu:', error);
            return [];
        }
    }

    getUserRole(member) {
        // Sprawdź które role TARGET ma użytkownik (0, 1, 2, main)
        const targetRoleIds = Object.values(this.config.targetRoles);
        
        for (const [roleName, roleId] of Object.entries(this.config.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                return roleName;
            }
        }
        
        return null;
    }

    async getMembersFromRole(guild, roleName) {
        try {
            const roleId = this.config.targetRoles[roleName];
            if (!roleId) {
                logger.error(`❌ Nie znaleziono ID roli dla: ${roleName}`);
                return [];
            }

            const members = await guild.members.fetch();
            const roleMembers = members.filter(member => member.roles.cache.has(roleId));
            
            return Array.from(roleMembers.values());
        } catch (error) {
            logger.error(`❌ Błąd pobierania członków roli ${roleName}:`, error);
            return [];
        }
    }

    findBestMemberMatch(word, roleMembers) {
        if (!word || word.length < 3) return null;

        let bestMatch = null;
        let bestSimilarity = 0;

        for (const member of roleMembers) {
            const similarity = calculateNameSimilarity(word, member.displayName);
            
            if (similarity >= 0.7 && similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestMatch = {
                    member: member,
                    similarity: similarity
                };
            }
        }

        return bestMatch;
    }

    async checkPlayerScoreNew(detectedNick, currentLine, allLines, currentIndex) {
        logger.info(`   🔍 Sprawdzam wynik dla gracza: ${detectedNick}`);

        // Znajdź pozycję nicka w linii
        const nickPosition = currentLine.indexOf(detectedNick);
        if (nickPosition === -1) {
            logger.info(`   ⚠️ Nie znaleziono nicka w linii`);
            return { scoreType: 'zero', scoreValue: '0' };
        }

        const afterNick = currentLine.substring(nickPosition + detectedNick.length);
        logger.info(`   📝 Tekst po nicku: "${afterNick}"`);

        // Krok 1: Sprawdź 3-cyfrowe liczby w tej samej linii
        const threeDigitResult = this.findThreeDigitScore(afterNick);
        if (threeDigitResult) {
            logger.info(`   📈 Znaleziono 3-cyfrowy wynik w tej samej linii: ${threeDigitResult}`);
            return { scoreType: 'three-digit', scoreValue: threeDigitResult };
        }

        // Krok 2: Dla długich nicków (≥13 znaków) sprawdź następną linię na 3-cyfrowe
        if (detectedNick.length >= 13 && currentIndex + 1 < allLines.length) {
            const nextLine = allLines[currentIndex + 1];
            logger.info(`   📝 Sprawdzam następną linię dla długiego nicka: "${nextLine}"`);
            
            const nextLineThreeDigit = this.findThreeDigitScore(nextLine);
            if (nextLineThreeDigit) {
                logger.info(`   📈 Znaleziono 3-cyfrowy wynik w następnej linii: ${nextLineThreeDigit}`);
                return { scoreType: 'three-digit', scoreValue: nextLineThreeDigit };
            }
        }

        // Krok 3: Sprawdź 2-cyfrowe liczby w tej samej linii
        const twoDigitResult = this.findTwoDigitScore(afterNick);
        if (twoDigitResult) {
            logger.info(`   📊 Znaleziono 2-cyfrowy wynik w tej samej linii: ${twoDigitResult}`);
            return { scoreType: 'two-digit', scoreValue: twoDigitResult };
        }

        // Krok 4: Dla długich nicków sprawdź następną linię na 2-cyfrowe
        if (detectedNick.length >= 13 && currentIndex + 1 < allLines.length) {
            const nextLine = allLines[currentIndex + 1];
            
            const nextLineTwoDigit = this.findTwoDigitScore(nextLine);
            if (nextLineTwoDigit) {
                logger.info(`   📊 Znaleziono 2-cyfrowy wynik w następnej linii: ${nextLineTwoDigit}`);
                return { scoreType: 'two-digit', scoreValue: nextLineTwoDigit };
            }
        }

        // Krok 5: Jeśli nie ma żadnych wyników, uznaj za zero
        logger.info(`   🔢 Nie znaleziono wyników liczbowych - uznano za zero`);
        return { scoreType: 'zero', scoreValue: '0' };
    }

    findThreeDigitScore(text) {
        // Wzorce dla 3-cyfrowych liczb
        const patterns = [
            /\s+(\d{3})\s+/,    // 3 cyfry otoczone spacjami
            /\s+(\d{3})$/,      // 3 cyfry na końcu
            /^(\d{3})\s+/,      // 3 cyfry na początku
            /\s+(\d{3})\./,     // 3 cyfry przed kropką
            /\s+(\d{3}),/,      // 3 cyfry przed przecinkiem
            /\s+(\d{3})[a-zA-Z]/  // 3 cyfry przed literą
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                return match[1];
            }
        }

        return null;
    }

    findTwoDigitScore(text) {
        // Wzorce dla 2-cyfrowych liczb (z możliwymi dodatkowymi znakami)
        const patterns = [
            /\s+(\d{2})\s+/,        // 2 cyfry otoczone spacjami
            /\s+(\d{2})$/,          // 2 cyfry na końcu
            /^(\d{2})\s+/,          // 2 cyfry na początku
            /\s+(\d{2})\./,         // 2 cyfry przed kropką
            /\s+(\d{2}),/,          // 2 cyfry przed przecinkiem
            /\s+(\d{2})[a-zA-Z]/,   // 2 cyfry przed literą
            /\s+(\d{2})[^\d\s]/,    // 2 cyfry przed znakiem specjalnym
            /[^\d](\d{2})[^\d]/,    // 2 cyfry między nie-cyframi
            /\s+(\d{2})\)/,         // 2 cyfry przed )
            /\((\d{2})\s+/,         // 2 cyfry po (
            /\s+(\d{2})\]/,         // 2 cyfry przed ]
            /\[(\d{2})\s+/          // 2 cyfry po [
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const number = parseInt(match[1]);
                // Sprawdź czy to sensowny wynik (10-99)
                if (number >= 10 && number <= 99) {
                    return match[1];
                }
            }
        }

        return null;
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
                return true;
            }
        }

        return false;
    }

    hasThreeDigitScore(line) {
        // Sprawdź czy linia zawiera 3-cyfrowy wynik
        const threeDigitPatterns = [
            /\s+\d{3}\s+/,  // 3 cyfry otoczone spacjami
            /\s+\d{3}$/,    // 3 cyfry na końcu linii
            /^\d{3}\s+/,    // 3 cyfry na początku linii
            /\s+\d{3}\./,   // 3 cyfry przed kropką
            /\s+\d{3},/     // 3 cyfry przed przecinkiem
        ];

        for (const pattern of threeDigitPatterns) {
            if (pattern.test(line)) {
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

    getThreeDigitElementsFromLine(line) {
        const threeDigitElements = [];

        // Wzorce 3-cyfrowych wyników
        const threeDigitPatterns = [
            /\s+(\d{3})\s+/g,  // 3 cyfry otoczone spacjami
            /\s+(\d{3})$/g,    // 3 cyfry na końcu linii
            /^(\d{3})\s+/g,    // 3 cyfry na początku linii
            /\s+(\d{3})\./g,   // 3 cyfry przed kropką
            /\s+(\d{3}),/g     // 3 cyfry przed przecinkiem
        ];

        // Znajdź wszystkie dopasowania w linii
        for (const pattern of threeDigitPatterns) {
            let match;
            while ((match = pattern.exec(line)) !== null) {
                threeDigitElements.push(match[1]);
            }
        }

        // Usuń duplikaty
        return [...new Set(threeDigitElements)];
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