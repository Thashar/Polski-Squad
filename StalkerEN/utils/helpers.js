const fs = require('fs').promises;
const path = require('path');

/**
 * Loguje wiadomość z timestamp w polskim formacie
 */
function logWithTimestamp(message, level = 'info') {
    const timestamp = new Date().toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    const prefix = level === 'error' ? '[ERROR]' : level === 'warn' ? '[WARN]' : '[INFO]';
    console.log(`[${timestamp}] ${prefix} ${message}`);
}

/**
 * Opóźnienie wykonania (delay)
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Tworzy obiekt Date w polskiej strefie czasowej
 */
function createPolandDate(dateInput) {
    const date = dateInput ? new Date(dateInput) : new Date();
    
    const polandTimeString = date.toLocaleString('sv-SE', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
    
    return new Date(polandTimeString);
}

/**
 * Pobiera aktualny czas w Polsce w formacie string
 */
function getCurrentPolandTime() {
    const now = new Date();
    return now.toLocaleString('pl-PL', {
        timeZone: 'Europe/Warsaw',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

/**
 * Sprawdza czy plik istnieje
 */
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Tworzy folder jeśli nie istnieje
 */
async function ensureDirectoryExists(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
    } catch (error) {
        logger.error(`Błąd tworzenia folderu ${dirPath}:`, error);
        return false;
    }
}

/**
 * Bezpieczne odczytanie pliku JSON
 */
async function safeReadJSON(filePath, defaultValue = {}) {
    try {
        if (await fileExists(filePath)) {
            const data = await fs.readFile(filePath, 'utf8');
            return JSON.parse(data);
        }
        return defaultValue;
    } catch (error) {
        logger.error(`Błąd odczytu pliku JSON ${filePath}:`, error);
        return defaultValue;
    }
}

/**
 * Bezpieczny zapis pliku JSON
 */
async function safeWriteJSON(filePath, data) {
    try {
        await ensureDirectoryExists(path.dirname(filePath));
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (error) {
        logger.error(`Błąd zapisu pliku JSON ${filePath}:`, error);
        return false;
    }
}

/**
 * Formatuje czas w sposób czytelny (np. "2h 30m")
 */
function formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
        return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
        return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
        return `${minutes}m`;
    } else {
        return `${seconds}s`;
    }
}

/**
 * Czyści tekst z niepotrzebnych znaków dla OCR
 */
function cleanTextForOCR(text) {
    return text
        .replace(/[^\w\sąćęłńóśźżĄĆĘŁŃÓŚŹŻ0-9.,;:!?\-()[\]{}/\\" ]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalizuje nazwę gracza do porównywania
 */
function normalizePlayerName(name) {
    return name
        .toLowerCase()
        .replace(/[^a-ząćęłńóśźż0-9]/g, '')
        .trim();
}

/**
 * Sprawdza czy nazwa gracza jest podobna do nazwy użytkownika
 */
function isNameSimilar(playerName, userName, threshold = 0.7) {
    const normalizedPlayer = normalizePlayerName(playerName);
    const normalizedUser = normalizePlayerName(userName);
    
    // Dokładne dopasowanie
    if (normalizedPlayer === normalizedUser) {
        return true;
    }
    
    // Sprawdzenie czy jedna nazwa zawiera drugą
    if (normalizedPlayer.includes(normalizedUser) || normalizedUser.includes(normalizedPlayer)) {
        return true;
    }
    
    // Algorytm Levenshtein dla podobieństwa
    const distance = levenshteinDistance(normalizedPlayer, normalizedUser);
    const maxLength = Math.max(normalizedPlayer.length, normalizedUser.length);
    const similarity = 1 - (distance / maxLength);
    
    return similarity >= threshold;
}

/**
 * Oblicza podobieństwo między dwoma nazwami graczy z uwzględnieniem długości
 */
function calculateNameSimilarity(playerName, userName) {
    const normalizedPlayer = normalizePlayerName(playerName);
    const normalizedUser = normalizePlayerName(userName);
    
    // Dokładne dopasowanie
    if (normalizedPlayer === normalizedUser) {
        return 1.0;
    }
    
    // Sprawdzenie czy jedna nazwa zawiera drugą
    if (normalizedPlayer.includes(normalizedUser) || normalizedUser.includes(normalizedPlayer)) {
        return 0.95; // Bardzo wysokie podobieństwo dla zawierania
    }
    
    // Algorytm Levenshtein dla podobieństwa
    const distance = levenshteinDistance(normalizedPlayer, normalizedUser);
    const maxLength = Math.max(normalizedPlayer.length, normalizedUser.length);
    const baseSimilarity = 1 - (distance / maxLength);
    
    // Bonus za podobną długość - im bardziej podobna długość, tym wyższy bonus
    const playerLength = normalizedPlayer.length;
    const userLength = normalizedUser.length;
    const lengthDifference = Math.abs(playerLength - userLength);
    const maxLengthForComparison = Math.max(playerLength, userLength);
    
    // Współczynnik długości (1.0 = identyczna długość, 0.0 = bardzo różna długość)
    const lengthSimilarity = maxLengthForComparison > 0 ? 1 - (lengthDifference / maxLengthForComparison) : 1;
    
    // Bonus za podobną długość (maksymalnie +0.1 do podobieństwa)
    const lengthBonus = lengthSimilarity * 0.1;
    
    // Końcowe podobieństwo z bonusem za długość, ale nie więcej niż 1.0
    const finalSimilarity = Math.min(1.0, baseSimilarity + lengthBonus);
    
    return finalSimilarity;
}

/**
 * Oblicza odległość Levenshtein między dwoma stringami
 */
function levenshteinDistance(str1, str2) {
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

/**
 * Tworzy embed z informacjami o błędzie
 */
function createErrorEmbed(title, description, fields = []) {
    const embed = {
        title: `❌ ${title}`,
        description: description,
        color: 0xFF0000,
        timestamp: new Date().toISOString(),
        fields: fields
    };
    
    return embed;
}

/**
 * Tworzy embed z informacjami o sukcesie
 */
function createSuccessEmbed(title, description, fields = []) {
    const embed = {
        title: `✅ ${title}`,
        description: description,
        color: 0x00FF00,
        timestamp: new Date().toISOString(),
        fields: fields
    };
    
    return embed;
}

/**
 * Tworzy embed z informacjami
 */
function createInfoEmbed(title, description, fields = [], color = 0x0099FF) {
    const embed = {
        title: title,
        description: description,
        color: color,
        timestamp: new Date().toISOString(),
        fields: fields
    };
    
    return embed;
}

/**
 * Sprawdza czy użytkownik ma wymagane uprawnienia
 */
function hasRequiredPermissions(member, requiredRoles) {
    if (!member || !member.roles) {
        return false;
    }
    
    return requiredRoles.some(roleId => member.roles.cache.has(roleId));
}

/**
 * Uzyskuje numer tygodnia w roku
 */
function getWeekNumber(date) {
    const target = new Date(date.valueOf());
    const dayNr = (date.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
        target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    return 1 + Math.ceil((firstThursday - target) / 604800000);
}

/**
 * Czyszczenie starych plików z folderu
 */
async function cleanupOldFiles(directoryPath, maxAgeHours = 24) {
    try {
        const files = await fs.readdir(directoryPath);
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000;
        
        for (const file of files) {
            const filePath = path.join(directoryPath, file);
            const stats = await fs.stat(filePath);
            
            if (now - stats.mtime.getTime() > maxAge) {
                await fs.unlink(filePath);
                // Usunięto stary plik (log nie potrzebny)
            }
        }
    } catch (error) {
        logger.error(`Błąd czyszczenia starych plików z ${directoryPath}:`, error);
    }
}

module.exports = {
    // logWithTimestamp - usunięto, używaj createBotLogger
    delay,
    createPolandDate,
    getCurrentPolandTime,
    fileExists,
    ensureDirectoryExists,
    safeReadJSON,
    safeWriteJSON,
    formatDuration,
    cleanTextForOCR,
    normalizePlayerName,
    isNameSimilar,
    calculateNameSimilarity,
    levenshteinDistance,
    createErrorEmbed,
    createSuccessEmbed,
    createInfoEmbed,
    hasRequiredPermissions,
    getWeekNumber,
    cleanupOldFiles
};