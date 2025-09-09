const Tesseract = require('tesseract.js');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

class OCRService {
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.configureTesseract();
        
        // Extended character whitelist for OCR
        this.EXTENDED_CHAR_WHITELIST = 
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
            '!@#$%^&*()_+-=[]{}|;:\'",.<>?/~`' +
            'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ' +
            'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя' +
            'あいうえおかきくけこアイウエオカキクケコ一二三四五六七八九十' +
            'ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ가나다라마바사아자차카타파하' +
            'ابتثجحخدذرزسشصضطظعغفقكلمنهويءآأؤإئ';
    }

    configureTesseract() {
        if (!process.env.TESSDATA_PREFIX) {
            const possiblePaths = process.platform === 'win32' ? [
                'C:\\Program Files\\Tesseract-OCR\\tessdata',
                'C:\\Program Files (x86)\\Tesseract-OCR\\tessdata'
            ] : [
                '/usr/share/tesseract-ocr/4.00/tessdata',
                '/usr/share/tesseract-ocr/tessdata',
                '/usr/local/share/tessdata',
                '/opt/homebrew/share/tessdata'
            ];
            
            for (const tessdataPath of possiblePaths) {
                try {
                    if (fs.existsSync(tessdataPath)) {
                        process.env.TESSDATA_PREFIX = path.dirname(tessdataPath);
                        this.logger.info(`✅ TESSDATA_PREFIX set to: ${process.env.TESSDATA_PREFIX}`);
                        break;
                    }
                } catch (error) {
                    continue;
                }
            }
        }
    }

    async performRobustOCR(imageBuffer) {
        const results = [];
        
        try {
            this.logger.info('🔍 Starting OCR with color inversion...');
            
            const invertedImage = await sharp(imageBuffer)
                .resize(null, 5000, { withoutEnlargement: false })
                .greyscale()
                .normalize()
                .negate()
                .linear(3.0, -(128 * 3.0) + 128)
                .sharpen({ sigma: 2.0, m1: 2.5, m2: 7.0 })
                .png()
                .toBuffer();
            
            const languageConfigs = this.config.ocrSettings?.supportedLanguages || ['eng', 'eng+jpn', 'eng+jpn+kor'];
            
            for (const lang of languageConfigs) {
                try {
                    const result = await Tesseract.recognize(invertedImage, lang, {
                        logger: m => {
                            if (m.status === 'recognizing text') {
                                this.logger.info(`OCR [${lang}]: ${Math.round(m.progress * 100)}%`);
                            }
                        },
                        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
                        tessedit_ocr_engine_mode: Tesseract.OEM.LSTM_ONLY,
                        tessedit_char_whitelist: this.EXTENDED_CHAR_WHITELIST
                    });
                    
                    if (result.data.confidence > 0) {
                        results.push({
                            method: `inverted_${lang}`,
                            text: result.data.text,
                            confidence: result.data.confidence
                        });
                        break;
                    }
                } catch (langError) {
                    continue;
                }
            }
            
            results.sort((a, b) => b.confidence - a.confidence);
            return results;
            
        } catch (error) {
            this.logger.error('❌ Error during OCR:', error);
            return [{
                method: 'fallback',
                text: 'Failed to recognize text',
                confidence: 0
            }];
        }
    }

    cleanText(text) {
        return text
            .replace(/\s+/g, '')
            .replace(/\u3000/g, '')
            .replace(/\u00A0/g, '')
            .replace(/['""`´''""]/g, '')
            .replace(/[=\-_|\\\/~+]/g, '')
            .trim();
    }

    calculateRealSimilarity(str1, str2) {
        if (!str1 || !str2) return 0;
        
        const normalized1 = str1.toLowerCase().trim();
        const normalized2 = str2.toLowerCase().trim();
        
        if (normalized1 === normalized2) return 1.0;
        
        const distance = this.levenshteinDistance(normalized1, normalized2);
        const maxLen = Math.max(normalized1.length, normalized2.length);
        
        return Math.max(0, 1 - (distance / maxLen));
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    findSimilarClans(searchTerm, clanData, minSimilarity = 0.49) {
        const matches = [];
        const cleanedSearchTerm = this.cleanText(searchTerm);
        
        for (const clan of clanData) {
            const cleanedClanName = this.cleanText(clan.name);
            const similarity = this.calculateRealSimilarity(cleanedSearchTerm, cleanedClanName);
            
            if (similarity >= minSimilarity) {
                matches.push({
                    clan: clan,
                    similarity: similarity,
                    matchType: similarity >= 0.95 ? 'exact' : similarity >= 0.8 ? 'high' : 'medium'
                });
            }
        }
        
        return matches.sort((a, b) => b.similarity - a.similarity);
    }
}

module.exports = OCRService;