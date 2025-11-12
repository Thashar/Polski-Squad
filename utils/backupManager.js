const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { google } = require('googleapis');
const https = require('https');
const { createBotLogger } = require('./consoleLogger');

const logger = createBotLogger('BackupManager');

/**
 * Manager do obsługi backupów folderów data botów do Google Drive
 */
class BackupManager {
    constructor() {
        this.botsFolder = path.join(__dirname, '..');
        this.backupsFolder = path.join(this.botsFolder, 'backups');
        this.maxBackupDays = 7;

        // Lista botów do backupu
        this.bots = [
            'EndersEcho',
            'Gary',
            'Konklawe',
            'Kontroler',
            'Muteusz',
            'Rekruter',
            'StalkerLME',
            'Szkolenia',
            'Wydarzynier'
        ];

        // Inicjalizacja Google Drive API
        this.drive = null;
        this.initializeDrive();
    }

    /**
     * Inicjalizacja Google Drive API
     */
    async initializeDrive() {
        try {
            const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
            if (!credentialsPath) {
                logger.warn('⚠️  GOOGLE_CREDENTIALS_PATH nie jest ustawiony w .env');
                return;
            }

            if (!fs.existsSync(credentialsPath)) {
                logger.warn(`⚠️  Plik credentials nie istnieje: ${credentialsPath}`);
                return;
            }

            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));

            const auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/drive.file']
            });

            this.drive = google.drive({ version: 'v3', auth });
            logger.info('✅ Google Drive API zainicjalizowane');
        } catch (error) {
            logger.error('❌ Błąd inicjalizacji Google Drive API:', error.message);
        }
    }

    /**
     * Wysyła podsumowanie backupu bezpośrednio na webhook backupu
     * @param {Object} results - Wyniki backupu { success: [], failed: [], totalSize: 0 }
     * @param {string} backupType - Typ backupu ('automatic' lub 'manual')
     * @param {string} triggerUser - Użytkownik który wywołał (tylko dla manual)
     */
    async sendBackupSummaryToWebhook(results, backupType = 'automatic', triggerUser = null) {
        const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL_BACKUP || process.env.DISCORD_LOG_WEBHOOK_URL;

        if (!webhookUrl) return;

        try {
            const timestamp = new Date().toLocaleString('pl-PL', {
                timeZone: 'Europe/Warsaw',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false
            });

            const totalSizeMB = (results.totalSize / 1024 / 1024).toFixed(2);
            const successCount = results.success.length;
            const failedCount = results.failed.length;
            const totalCount = successCount + failedCount;

            // Tytuł w zależności od typu backupu
            let title = backupType === 'manual'
                ? `📦 **MANUALNY BACKUP** ${triggerUser ? `(${triggerUser})` : ''}`
                : `💾 **AUTOMATYCZNY BACKUP**`;

            // Podsumowanie
            let summary = `**${successCount}/${totalCount} botów zarchiwizowanych** | **${totalSizeMB} MB**\n\n`;

            // Lista botów z sukcesem
            if (results.success.length > 0) {
                results.success.forEach(item => {
                    const sizeMB = (item.size / 1024 / 1024).toFixed(2);
                    summary += `✅ **${item.bot}** - ${sizeMB} MB\n`;
                });
            }

            // Lista botów z błędami
            if (results.failed.length > 0) {
                summary += '\n';
                results.failed.forEach(item => {
                    const reason = item.reason === 'Pusty folder data' ? '📭' : '❌';
                    summary += `${reason} **${item.bot}** - ${item.reason}\n`;
                });
            }

            // Dodaj timestamp na końcu
            summary += `\n🕐 ${timestamp}`;

            const message = `────────────────────────────────────────────────────────────────────────────────\n${title}\n\n${summary}`;

            // Wyślij na webhook
            const data = JSON.stringify({ content: message });
            const url = new URL(webhookUrl);

            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve();
                    } else {
                        reject(new Error(`Webhook error status: ${res.statusCode}`));
                    }
                });

                req.on('error', (error) => {
                    reject(error);
                });

                req.write(data);
                req.end();
            });

        } catch (error) {
            logger.error('❌ Błąd wysyłania podsumowania na webhook:', error.message);
        }
    }

    /**
     * Tworzy folder backups jeśli nie istnieje
     */
    ensureBackupsFolder() {
        if (!fs.existsSync(this.backupsFolder)) {
            fs.mkdirSync(this.backupsFolder, { recursive: true });
            logger.info('📁 Utworzono folder backups');
        }
    }

    /**
     * Tworzy archiwum ZIP z folderu data bota
     * @param {string} botName - Nazwa bota
     * @returns {Promise<string>} - Ścieżka do utworzonego archiwum
     */
    async createBotArchive(botName) {
        return new Promise(async (resolve, reject) => {
            try {
                const dataFolder = path.join(this.botsFolder, botName, 'data');

                // Sprawdź czy folder data istnieje
                if (!fs.existsSync(dataFolder)) {
                    logger.warn(`⚠️  Folder data nie istnieje dla bota: ${botName}`);
                    resolve(null);
                    return;
                }

                // Sprawdź czy folder data jest pusty
                const files = fs.readdirSync(dataFolder);
                if (files.length === 0) {
                    logger.warn(`⚠️  Folder data jest pusty dla bota: ${botName}`);
                    resolve(null);
                    return;
                }

                this.ensureBackupsFolder();

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
                const archiveName = `${botName}_${timestamp}.zip`;
                const archivePath = path.join(this.backupsFolder, archiveName);

                const output = fs.createWriteStream(archivePath);
                const archive = archiver('zip', { zlib: { level: 9 } });

                output.on('close', () => {
                    const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
                    logger.info(`✅ Utworzono archiwum: ${archiveName} (${sizeMB} MB)`);
                    resolve(archivePath);
                });

                archive.on('error', (err) => {
                    logger.error(`❌ Błąd tworzenia archiwum ${botName}:`, err.message);
                    reject(err);
                });

                archive.pipe(output);
                archive.directory(dataFolder, false);
                await archive.finalize();

            } catch (error) {
                logger.error(`❌ Błąd podczas tworzenia archiwum ${botName}:`, error.message);
                reject(error);
            }
        });
    }

    /**
     * Sprawdza czy folder Google Drive istnieje, jeśli nie - tworzy go
     * @param {string} folderName - Nazwa folderu
     * @returns {Promise<string>} - ID folderu
     */
    async ensureDriveFolder(folderName) {
        try {
            // Sprawdź czy folder już istnieje
            const response = await this.drive.files.list({
                q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            }

            // Utwórz folder
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder'
            };

            const folder = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id'
            });

            logger.info(`📁 Utworzono folder na Google Drive: ${folderName}`);
            return folder.data.id;

        } catch (error) {
            logger.error('❌ Błąd tworzenia folderu na Google Drive:', error.message);
            throw error;
        }
    }

    /**
     * Wysyła archiwum do Google Drive
     * @param {string} archivePath - Ścieżka do archiwum
     * @param {string} botName - Nazwa bota
     * @returns {Promise<Object|null>} - Obiekt z informacjami o uploadzie lub null w przypadku błędu
     */
    async uploadToGoogleDrive(archivePath, botName) {
        if (!this.drive) {
            logger.warn('⚠️  Google Drive nie jest zainicjalizowany - pomijam upload');
            return null;
        }

        try {
            // Upewnij się, że główny folder backupów istnieje
            const backupFolderId = await this.ensureDriveFolder('Polski_Squad_Backups');

            // Upewnij się, że folder bota istnieje
            const botFolderId = await this.ensureBotFolder(backupFolderId, botName);

            const fileName = path.basename(archivePath);
            const fileMetadata = {
                name: fileName,
                parents: [botFolderId]
            };

            const media = {
                mimeType: 'application/zip',
                body: fs.createReadStream(archivePath)
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, size'
            });

            const sizeMB = (response.data.size / 1024 / 1024).toFixed(2);
            logger.info(`☁️  Przesłano do Google Drive: ${fileName} (${sizeMB} MB)`);

            // Usuń lokalny plik po przesłaniu
            fs.unlinkSync(archivePath);
            logger.info(`🗑️  Usunięto lokalny plik: ${fileName}`);

            return {
                fileId: response.data.id,
                fileName: fileName,
                size: parseInt(response.data.size)
            };

        } catch (error) {
            logger.error('❌ Błąd przesyłania do Google Drive:', error.message);
            return null;
        }
    }

    /**
     * Sprawdza czy folder bota istnieje w folderze backupów, jeśli nie - tworzy go
     * @param {string} parentFolderId - ID folderu nadrzędnego
     * @param {string} botName - Nazwa bota
     * @returns {Promise<string>} - ID folderu bota
     */
    async ensureBotFolder(parentFolderId, botName) {
        try {
            // Sprawdź czy folder bota już istnieje
            const response = await this.drive.files.list({
                q: `name='${botName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                spaces: 'drive'
            });

            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            }

            // Utwórz folder bota
            const fileMetadata = {
                name: botName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentFolderId]
            };

            const folder = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id'
            });

            logger.info(`📁 Utworzono folder bota na Google Drive: ${botName}`);
            return folder.data.id;

        } catch (error) {
            logger.error(`❌ Błąd tworzenia folderu bota ${botName}:`, error.message);
            throw error;
        }
    }

    /**
     * Usuwa stare backupy z Google Drive (starsze niż maxBackupDays)
     * @param {string} botName - Nazwa bota
     */
    async cleanOldBackups(botName) {
        if (!this.drive) {
            return;
        }

        try {
            // Znajdź folder backupów
            const backupFolderId = await this.ensureDriveFolder('Polski_Squad_Backups');
            const botFolderId = await this.ensureBotFolder(backupFolderId, botName);

            // Pobierz listę plików w folderze bota
            const response = await this.drive.files.list({
                q: `'${botFolderId}' in parents and trashed=false`,
                fields: 'files(id, name, createdTime)',
                orderBy: 'createdTime desc',
                spaces: 'drive'
            });

            const files = response.data.files;

            // Jeśli mamy więcej niż maxBackupDays plików, usuń najstarsze
            if (files.length > this.maxBackupDays) {
                const filesToDelete = files.slice(this.maxBackupDays);

                for (const file of filesToDelete) {
                    await this.drive.files.delete({ fileId: file.id });
                    logger.info(`🗑️  Usunięto stary backup z Google Drive: ${file.name}`);
                }
            }

        } catch (error) {
            logger.error(`❌ Błąd czyszczenia starych backupów dla ${botName}:`, error.message);
        }
    }

    /**
     * Wykonuje backup wszystkich botów
     */
    async backupAll() {
        logger.info('🚀 Rozpoczynam backup wszystkich botów...');

        const results = {
            success: [],
            failed: [],
            totalSize: 0
        };

        for (const botName of this.bots) {
            try {
                logger.info(`📦 Backup bota: ${botName}`);

                // Utwórz archiwum
                const archivePath = await this.createBotArchive(botName);

                if (!archivePath) {
                    results.failed.push({ bot: botName, reason: 'Pusty folder data' });
                    continue;
                }

                // Prześlij do Google Drive
                const uploadResult = await this.uploadToGoogleDrive(archivePath, botName);

                if (uploadResult) {
                    results.success.push({ bot: botName, size: uploadResult.size });
                    results.totalSize += uploadResult.size;

                    // Wyczyść stare backupy
                    await this.cleanOldBackups(botName);
                } else {
                    results.failed.push({ bot: botName, reason: 'Błąd uploadu' });
                }

            } catch (error) {
                logger.error(`❌ Błąd podczas backupu ${botName}:`, error.message);
                results.failed.push({ bot: botName, reason: error.message });
            }
        }

        logger.info('✅ Backup zakończony!');

        // Wyślij podsumowanie na webhook backupu
        await this.sendBackupSummaryToWebhook(results, 'automatic');
    }

    /**
     * Tworzy manualny backup wszystkich botów (niezależny - nie będzie usuwany)
     * @param {string} triggerUser - Nazwa użytkownika, który wywołał backup
     * @returns {Promise<Object>} - Obiekt z informacjami o backupie
     */
    async createManualBackup(triggerUser = 'Unknown') {
        logger.info(`🚀 Rozpoczynam manualny backup (wywołany przez: ${triggerUser})...`);

        const results = {
            success: [],
            failed: [],
            totalSize: 0
        };

        for (const botName of this.bots) {
            try {
                logger.info(`📦 Manualny backup bota: ${botName}`);

                // Utwórz archiwum
                const archivePath = await this.createBotArchive(botName);

                if (!archivePath) {
                    results.failed.push({ bot: botName, reason: 'Pusty folder data' });
                    continue;
                }

                // Prześlij do Google Drive (do folderu Manual_Backups)
                const uploadResult = await this.uploadManualBackupToDrive(archivePath, botName, triggerUser);

                if (uploadResult) {
                    results.success.push({ bot: botName, size: uploadResult.size });
                    results.totalSize += uploadResult.size;
                } else {
                    results.failed.push({ bot: botName, reason: 'Błąd uploadu' });
                }

            } catch (error) {
                logger.error(`❌ Błąd podczas manualnego backupu ${botName}:`, error.message);
                results.failed.push({ bot: botName, reason: error.message });
            }
        }

        logger.info(`✅ Manualny backup zakończony! Sukces: ${results.success.length}, Błędy: ${results.failed.length}`);

        // Wyślij podsumowanie na webhook backupu
        await this.sendBackupSummaryToWebhook(results, 'manual', triggerUser);

        return results;
    }

    /**
     * Wysyła manualny backup do Google Drive (do osobnego folderu Manual_Backups)
     * @param {string} archivePath - Ścieżka do archiwum
     * @param {string} botName - Nazwa bota
     * @param {string} triggerUser - Użytkownik który wywołał backup
     * @returns {Promise<Object>} - Obiekt z informacjami o przesłanym pliku
     */
    async uploadManualBackupToDrive(archivePath, botName, triggerUser) {
        if (!this.drive) {
            logger.warn('⚠️  Google Drive nie jest zainicjalizowany - pomijam upload');
            return null;
        }

        try {
            // Upewnij się, że folder Manual_Backups istnieje
            const manualBackupFolderId = await this.ensureDriveFolder('Polski_Squad_Manual_Backups');

            // Upewnij się, że folder bota istnieje w Manual_Backups
            const botFolderId = await this.ensureBotFolder(manualBackupFolderId, botName);

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `${botName}_MANUAL_${timestamp}_by_${triggerUser}.zip`;
            const fileMetadata = {
                name: fileName,
                parents: [botFolderId],
                description: `Manual backup triggered by ${triggerUser} at ${new Date().toLocaleString('pl-PL')}`
            };

            const media = {
                mimeType: 'application/zip',
                body: fs.createReadStream(archivePath)
            };

            const response = await this.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id, name, size'
            });

            const sizeMB = (response.data.size / 1024 / 1024).toFixed(2);
            logger.info(`☁️  Przesłano manualny backup do Google Drive: ${fileName} (${sizeMB} MB)`);

            // Usuń lokalny plik po przesłaniu
            fs.unlinkSync(archivePath);
            logger.info(`🗑️  Usunięto lokalny plik: ${fileName}`);

            return {
                fileId: response.data.id,
                fileName: fileName,
                size: parseInt(response.data.size)
            };

        } catch (error) {
            logger.error('❌ Błąd przesyłania manualnego backupu do Google Drive:', error.message);
            return null;
        }
    }
}

module.exports = BackupManager;
