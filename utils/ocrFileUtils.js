const fs = require('fs').promises;
const path = require('path');

/**
 * Generuje nazwę pliku w formacie [BOT][ rrrr-mm-dd hh:mm:ss ][] lub [BOT][ rrrr-mm-dd hh:mm:ss ][TYP]
 * @param {string} botName - Nazwa bota (np. 'KONTROLER', 'STALKER', 'ENDERSECHO', 'REKRUTER')
 * @param {string} type - Typ zdjęcia (np. 'daily', 'cx', 'stalker', 'endersecho', 'rekruter')
 * @returns {string} - Nazwa pliku
 */
function generateProcessedFilename(botName, type) {
    const now = new Date();
    
    // Format DATA-GODZINA: rrrr-mm-dd hh:mm:ss
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const hour = now.getHours().toString().padStart(2, '0');
    const minute = now.getMinutes().toString().padStart(2, '0');
    const second = now.getSeconds().toString().padStart(2, '0');
    const timeStr = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    
    // Dodaj spacje w nawiasach kwadratowych i określ czy pokazać typ
    const botNamePart = `[${botName.toUpperCase()}]`;
    const timePart = `[ ${timeStr} ]`;
    
    // Tylko Kontroler z daily/cx pokazuje typ, inne boty mają pustą sekcję
    let typePart = '[]';
    if (botName.toUpperCase() === 'KONTROLER' && (type === 'daily' || type === 'cx')) {
        typePart = `[${type}]`;
    }
    
    return `${botNamePart}${timePart}${typePart}.png`;
}

/**
 * Czyści stare pliki, pozostawiając tylko określoną liczbę najnowszych
 * @param {string} processedDir - Ścieżka do folderu z przetworzonymi plikami
 * @param {number} maxFiles - Maksymalna liczba plików do zachowania
 * @param {Function} logger - Logger do logowania informacji
 */
async function cleanupOldProcessedFiles(processedDir, maxFiles, logger) {
    try {
        await fs.mkdir(processedDir, { recursive: true });
        const files = await fs.readdir(processedDir);

        // Najpierw usuń osierocone pliki temp (starsze niż 10 minut)
        const tempFiles = files.filter(file => file.startsWith('temp_') && file.endsWith('.png'));
        if (tempFiles.length > 0) {
            const now = Date.now();
            for (const file of tempFiles) {
                try {
                    const filePath = path.join(processedDir, file);
                    const stats = await fs.stat(filePath);
                    if (now - stats.mtimeMs > 10 * 60 * 1000) {
                        await fs.unlink(filePath);
                        logger.info(`🗑️ Usunięto osierocony plik temp: ${file}`);
                    }
                } catch (err) { /* plik mógł być już usunięty */ }
            }
        }

        const imageFiles = files.filter(file => file.endsWith('.png') && !file.startsWith('temp_'));

        if (imageFiles.length <= maxFiles) {
            return;
        }
        
        // Pobierz statystyki plików
        const fileStats = [];
        for (const file of imageFiles) {
            const filePath = path.join(processedDir, file);
            const stats = await fs.stat(filePath);
            fileStats.push({
                file,
                filePath,
                mtime: stats.mtime
            });
        }
        
        // Posortuj po czasie modyfikacji (najstarsze pierwsze)
        fileStats.sort((a, b) => a.mtime - b.mtime);
        
        // Usuń najstarsze pliki
        const filesToDelete = fileStats.slice(0, fileStats.length - maxFiles);
        
        for (const { file, filePath } of filesToDelete) {
            await fs.unlink(filePath);
            logger.info(`🗑️ Usunięto stary plik: ${file}`);
        }
        
        if (filesToDelete.length > 0) {
            logger.info(`🧹 Usunięto ${filesToDelete.length} starych plików (limit: ${maxFiles})`);
        }
    } catch (error) {
        logger.error(`Błąd czyszczenia starych plików: ${error.message}`);
    }
}

/**
 * Zapisuje przetworzony obraz z automatycznym czyszczeniem starych plików
 * @param {string} sourcePath - Ścieżka do źródłowego pliku
 * @param {string} processedDir - Folder docelowy
 * @param {string} botName - Nazwa bota
 * @param {string} type - Typ obrazu
 * @param {number} maxFiles - Maksymalna liczba plików
 * @param {Function} logger - Logger
 */
async function saveProcessedImage(sourcePath, processedDir, botName, type, maxFiles, logger) {
    try {
        // Utwórz folder jeśli nie istnieje
        await fs.mkdir(processedDir, { recursive: true });
        
        // Wygeneruj nazwę pliku
        const filename = generateProcessedFilename(botName, type);
        const savedPath = path.join(processedDir, filename);
        
        // Skopiuj plik
        await fs.copyFile(sourcePath, savedPath);
        logger.info(`💾 Zapisano przetworzone zdjęcie ${botName}/${type}: ${filename}`);
        
        // Wyczyść stare pliki
        await cleanupOldProcessedFiles(processedDir, maxFiles, logger);
        
        return savedPath;
    } catch (error) {
        logger.error(`Błąd zapisu przetworzonego zdjęcia ${botName}/${type}: ${error.message}`);
        return null;
    }
}

/**
 * Czyści osierocone pliki tymczasowe (temp_*.png) starsze niż maxAgeMs
 * @param {string} processedDir - Ścieżka do folderu z przetworzonymi plikami
 * @param {number} maxAgeMs - Maksymalny wiek pliku w ms (domyślnie 10 minut)
 * @param {Function} logger - Logger do logowania informacji
 */
async function cleanupOrphanedTempFiles(processedDir, maxAgeMs = 10 * 60 * 1000, logger) {
    try {
        await fs.mkdir(processedDir, { recursive: true });
        const files = await fs.readdir(processedDir);
        const tempFiles = files.filter(file => file.startsWith('temp_') && file.endsWith('.png'));

        if (tempFiles.length === 0) return 0;

        const now = Date.now();
        let deletedCount = 0;

        for (const file of tempFiles) {
            try {
                const filePath = path.join(processedDir, file);
                const stats = await fs.stat(filePath);

                if (now - stats.mtimeMs > maxAgeMs) {
                    await fs.unlink(filePath);
                    deletedCount++;
                }
            } catch (err) {
                // Plik mógł zostać usunięty przez inny proces
            }
        }

        if (deletedCount > 0 && logger) {
            logger.info(`🧹 Usunięto ${deletedCount} osieroconych plików temp z processed_ocr/`);
        }

        return deletedCount;
    } catch (error) {
        if (logger) {
            logger.error(`Błąd czyszczenia plików temp: ${error.message}`);
        }
        return 0;
    }
}

module.exports = {
    generateProcessedFilename,
    cleanupOldProcessedFiles,
    cleanupOrphanedTempFiles,
    saveProcessedImage
};