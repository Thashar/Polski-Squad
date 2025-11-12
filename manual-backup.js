require('dotenv').config();
const BackupManager = require('./utils/backupManager');
const { createBotLogger } = require('./utils/consoleLogger');

const logger = createBotLogger('ManualBackup');

/**
 * Skrypt do manualnego uruchomienia backupu
 * Użycie: node manual-backup.js
 */
async function runBackup() {
    logger.info('🚀 Uruchamiam manualny backup...');

    try {
        const manager = new BackupManager();

        // Czekaj chwilę na inicjalizację Google Drive API
        await new Promise(resolve => setTimeout(resolve, 2000));

        await manager.backupAll();

        logger.info('✅ Manualny backup zakończony pomyślnie!');
        process.exit(0);
    } catch (error) {
        logger.error('❌ Błąd podczas manualnego backupu:', error.message);
        process.exit(1);
    }
}

runBackup();
