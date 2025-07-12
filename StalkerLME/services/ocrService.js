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
            // Najpierw sprawdzamy obecną rozdzielczość i zwiększamy ją
            const image = sharp(imageBuffer);
            const metadata = await image.metadata();
            
            logger.info(`📏 Oryginalna rozdzielczość: ${metadata.width}x${metadata.height}`);
            
            // Zwiększamy rozdzielczość 2x dla lepszego OCR
            const scaleFactor = 2;
            const newWidth = metadata.width * scaleFactor;
            const newHeight = metadata.height * scaleFactor;
            
            logger.info(`📈 Zwiększam rozdzielczość do: ${newWidth}x${newHeight}`);
            
            // Przetwarzanie obrazu z fokusem na biały tekst
            const processedBuffer = await image
                .resize(newWidth, newHeight, {
                    kernel: 'lanczos3' // Wysokiej jakości interpolacja
                })
                .greyscale()
                // Zwiększamy kontrast aby wydobyć biały tekst
                .normalize() // Rozciąga histogram dla lepszego kontrastu
                .linear(1.5, -50) // Zwiększamy kontrast i zmniejszamy jasność tła
                // Threshold optymalizowany dla białego tekstu na ciemnym tle
                .threshold(180) // Wyższy próg dla białego tekstu
                .sharpen(2, 1, 2) // Ostrzejsze wyostrzenie
                .png()
                .toBuffer();
            
            logger.info('✅ Obraz przetworzony z fokusem na biały tekst');
            return processedBuffer;
        } catch (error) {
            logger.error('❌ Błąd podczas przetwarzania obrazu:', error);
            throw error;
        }
    }

    extractPlayersFromText(text) {
        try {
            logger.info('Analiza tekstu');
            logger.info('🎯 Szukanie graczy z wynikiem 0...');
            
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
                        logger.info(`👤 Znaleziono gracza z wynikiem 0: ${longestWord} (najdłuższe z: ${playerCandidates.join(', ')})`);
                    }
                }
            }
            
            logger.info(`Znaleziono ${zeroScorePlayers.length} graczy z wynikiem 0`);
            logger.info(`👥 Lista: ${zeroScorePlayers.join(', ')}`);
            return zeroScorePlayers;
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