require('dotenv').config();
const cron = require('node-cron');
const BackupManager = require('./utils/backupManager');
const { createBotLogger } = require('./utils/consoleLogger');

const logger = createBotLogger('BackupScheduler');

/**
 * Scheduler do automatycznego wykonywania backupów
 */
class BackupScheduler {
    constructor() {
        this.backupManager = new BackupManager();
        this.task = null;

        // Domyślna godzina backupu (3:00 w nocy)
        this.cronSchedule = process.env.BACKUP_CRON || '0 3 * * *';
    }

    /**
     * Uruchamia scheduler
     */
    start() {
        logger.info('🕐 Uruchamiam scheduler backupów...');
        logger.info(`📅 Harmonogram: ${this.cronSchedule} (codziennie o 3:00)`);

        // Walidacja cron schedule
        if (!cron.validate(this.cronSchedule)) {
            logger.error('❌ Nieprawidłowy format BACKUP_CRON w .env');
            return;
        }

        // Utwórz zadanie cron
        this.task = cron.schedule(this.cronSchedule, async () => {
            logger.info('⏰ Uruchamiam zaplanowany backup...');
            try {
                await this.backupManager.backupAll();
            } catch (error) {
                logger.error('❌ Błąd podczas zaplanowanego backupu:', error.message);
                logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
                logger.error(`   Kod błędu: ${error.code || 'brak'}`);
                logger.error(`   Harmonogram: ${this.cronSchedule}`);
                if (error.stack) {
                    logger.error(`   Stack trace: ${error.stack}`);
                }
            }
        });

        logger.info('✅ Scheduler backupów aktywny');

        // Jeśli ustawiono BACKUP_ON_START=true, wykonaj backup zaraz po starcie
        if (process.env.BACKUP_ON_START === 'true') {
            logger.info('🚀 BACKUP_ON_START=true - wykonuję backup...');
            setTimeout(async () => {
                try {
                    await this.backupManager.backupAll();
                } catch (error) {
                    logger.error('❌ Błąd podczas startowego backupu:', error.message);
                    logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
                    logger.error(`   Kod błędu: ${error.code || 'brak'}`);
                    if (error.stack) {
                        logger.error(`   Stack trace: ${error.stack}`);
                    }
                }
            }, 5000); // Odczekaj 5 sekund po starcie botów
        }
    }

    /**
     * Zatrzymuje scheduler
     */
    stop() {
        if (this.task) {
            this.task.stop();
            logger.info('🛑 Scheduler backupów zatrzymany');
        }
    }

    /**
     * Wykonuje backup manualnie (bez czekania na zaplanowaną godzinę)
     */
    async runManualBackup() {
        logger.info('🚀 Rozpoczynam manualny backup...');
        try {
            await this.backupManager.backupAll();
        } catch (error) {
            logger.error('❌ Błąd podczas manualnego backupu:', error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);
            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
        }
    }
}

// Export klasy i instancji
const scheduler = new BackupScheduler();

module.exports = {
    BackupScheduler,
    scheduler
};
