const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const { calculateNameSimilarity } = require('../utils/helpers');

class OCRService {
    constructor(config) {
        this.config = config;
        this.tempDir = './StalkerLME/temp';
    }

    async initializeOCR() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
            console.log('[OCR] ✅ Serwis OCR zainicjalizowany');
        } catch (error) {
            console.error('[OCR] ❌ Błąd inicjalizacji OCR:', error);
        }
    }

    async processImage(attachment) {
        try {
            console.log('\n🔍 ==================== ROZPOCZĘCIE ANALIZY OCR ====================');
            console.log(`📷 Przetwarzanie obrazu: ${attachment.url}`);
            
            const response = await fetch(attachment.url);
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            console.log('⚫⚪ ==================== KONWERSJA NA CZARNO-BIAŁY ====================');
            console.log('🎨 Rozpoczynam przetwarzanie obrazu...');
            const processedBuffer = await this.processImageWithSharp(buffer);
            console.log('✅ Przetwarzanie obrazu zakończone');
            
            console.log('\n📖 ==================== URUCHAMIANIE OCR ====================');
            const { data: { text } } = await Tesseract.recognize(processedBuffer, 'pol', {
                logger: m => {
                    if (m.status === 'recognizing text') {
                        console.log(`📊 OCR Progress: ${Math.round(m.progress * 100)}%`);
                    }
                },
                tessedit_char_whitelist: this.config.ocr.polishAlphabet
            });
            
            console.log('\n📄 ==================== PEŁNY TEKST Z OCR ====================');
            console.log('🔤 Odczytany tekst:');
            console.log('--- POCZĄTEK TEKSTU ---');
            console.log(text);
            console.log('--- KONIEC TEKSTU ---');
            
            return text;
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD OCR ====================');
            console.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        }
    }

    async processImageWithSharp(imageBuffer) {
        try {
            // Używamy Sharp do symulacji oryginalnej logiki Canvas
            const processedBuffer = await sharp(imageBuffer)
                .greyscale()
                .threshold(this.config.ocr.imageProcessing.whiteThreshold)
                .linear(this.config.ocr.imageProcessing.contrast, this.config.ocr.imageProcessing.brightness)
                .sharpen()
                .png()
                .toBuffer();
            
            return processedBuffer;
        } catch (error) {
            console.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        }
    }

    extractPlayersFromText(text) {
        try {
            console.log('\n🔍 ==================== ANALIZA TEKSTU ====================');
            console.log('🎯 Szukanie graczy z wynikiem 0...');
            
            const lines = text.split('\n').filter(line => line.trim().length > 0);
            const zeroScorePlayers = [];
            
            for (const line of lines) {
                if (this.hasZeroScore(line)) {
                    // Wyciągamy prawdopodobną nazwę gracza z linii - wybieramy najdłuższe słowo
                    const words = line.split(/\s+/);
                    const playerCandidates = words.filter(word => this.isLikelyPlayerName(word));
                    
                    if (playerCandidates.length > 0) {
                        // Znajdź najdłuższe słowo jako nick
                        const longestWord = playerCandidates.reduce((longest, current) => 
                            current.length > longest.length ? current : longest
                        );
                        zeroScorePlayers.push(longestWord);
                        console.log(`👤 Znaleziono gracza z wynikiem 0: ${longestWord} (najdłuższe z: ${playerCandidates.join(', ')})`);
                    }
                }
            }
            
            console.log(`\n🎯 Znaleziono ${zeroScorePlayers.length} graczy z wynikiem 0`);
            console.log(`👥 Lista: ${zeroScorePlayers.join(', ')}`);
            return zeroScorePlayers;
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD ANALIZY TEKSTU ====================');
            console.error('❌ Błąd analizy tekstu:', error);
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
            console.log('\n👥 ==================== WYSZUKIWANIE UŻYTKOWNIKÓW ====================');
            console.log(`🏰 Serwer: ${guild.name}`);
            console.log(`🔍 Szukane nazwy: ${playerNames.join(', ')}`);
            
            const foundUsers = [];
            const members = await guild.members.fetch();
            console.log(`👥 Znaleziono ${members.size} członków serwera`);
            
            // Sprawdź czy użytkownik ma którejś z ról TARGET i ogranicz wyszukiwanie
            let restrictToRole = null;
            if (requestingMember) {
                const targetRoleIds = Object.values(this.config.targetRoles);
                for (const roleId of targetRoleIds) {
                    if (requestingMember.roles.cache.has(roleId)) {
                        restrictToRole = roleId;
                        console.log(`🎯 Ograniczam wyszukiwanie do roli: ${roleId}`);
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
                    
                    // Sprawdź podobieństwo z displayName i username, wybierz wyższą wartość
                    const displaySimilarity = calculateNameSimilarity(playerName, member.displayName);
                    const usernameSimilarity = calculateNameSimilarity(playerName, member.user.username);
                    
                    const maxSimilarity = Math.max(displaySimilarity, usernameSimilarity);
                    const matchedField = displaySimilarity >= usernameSimilarity ? 'displayName' : 'username';
                    
                    if (maxSimilarity >= 0.7) {
                        candidates.push({
                            userId: userId,
                            member: member,
                            matchedName: playerName,
                            displayName: member.displayName,
                            similarity: maxSimilarity,
                            matchedField: matchedField
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
                    
                    console.log(`✅ Dopasowano: ${playerName} -> ${bestMatch.member.displayName} (${bestMatch.member.user.username}) - ${(bestMatch.similarity * 100).toFixed(1)}% podobieństwa`);
                    
                    // Pokaż alternatywnych kandydatów jeśli jest ich więcej
                    if (candidates.length > 1) {
                        console.log(`   Alternatywni kandydaci:`);
                        for (let i = 1; i < Math.min(candidates.length, 3); i++) {
                            const alt = candidates[i];
                            console.log(`   - ${alt.member.displayName} (${alt.member.user.username}) - ${(alt.similarity * 100).toFixed(1)}%`);
                        }
                    }
                } else {
                    console.log(`❌ Nie znaleziono kandydata z minimum 70% podobieństwa dla: ${playerName}`);
                }
            }
            
            console.log(`\n✅ Dopasowano ${foundUsers.length}/${playerNames.length} użytkowników`);
            if (restrictToRole) {
                console.log(`🎯 Wyszukiwanie ograniczone do roli: ${restrictToRole}`);
            }
            return foundUsers;
        } catch (error) {
            console.error('\n💥 ==================== BŁĄD WYSZUKIWANIA ====================');
            console.error('❌ Błąd wyszukiwania użytkowników:', error);
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
                    console.log(`[OCR] 🗑️ Usunięto stary plik tymczasowy: ${file}`);
                }
            }
        } catch (error) {
            console.error('[OCR] ❌ Błąd czyszczenia plików tymczasowych:', error);
        }
    }
}

module.exports = OCRService;