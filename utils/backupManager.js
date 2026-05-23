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
            'Stalker',
            'Szkolenia',
            'Wydarzynier',
            'shared_data'
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
            const tokenPath = path.join(__dirname, '..', 'token.json');

            if (!credentialsPath) {
                logger.warn('⚠️  GOOGLE_CREDENTIALS_PATH nie jest ustawiony w .env');
                return;
            }

            if (!fs.existsSync(credentialsPath)) {
                logger.warn(`⚠️  Plik credentials nie istnieje: ${credentialsPath}`);
                return;
            }

            if (!fs.existsSync(tokenPath)) {
                logger.warn('⚠️  Token nie istnieje. Uruchom: node authorize-google.js');
                return;
            }

            const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
            const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

            const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
            const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
            oAuth2Client.setCredentials(token);

            // Automatyczne zapisywanie odświeżonych tokenów
            oAuth2Client.on('tokens', (tokens) => {
                try {
                    if (tokens.refresh_token) {
                        // Zapisz pełny nowy token
                        logger.info('🔄 Odświeżono token OAuth - zapisuję do pliku');
                        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
                    } else {
                        // Zaktualizuj tylko access_token (refresh_token został zachowany)
                        const existingToken = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
                        const updatedToken = { ...existingToken, ...tokens };
                        logger.info('🔄 Odświeżono access_token - zapisuję do pliku');
                        fs.writeFileSync(tokenPath, JSON.stringify(updatedToken, null, 2));
                    }
                } catch (error) {
                    logger.error('❌ Błąd zapisywania odświeżonego tokenu:', error.message);
                }
            });

            this.drive = google.drive({ version: 'v3', auth: oAuth2Client });
            logger.info('✅ Google Drive API zainicjalizowane');
        } catch (error) {
            logger.error('❌ Błąd inicjalizacji Google Drive API:', error);
            console.error('Szczegóły błędu:', error);
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

            const message = `${title}\n\n${summary}`;

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
                // shared_data to specjalny folder w głównym katalogu projektu (bez podfolderu 'data')
                const dataFolder = botName === 'shared_data'
                    ? path.join(this.botsFolder, 'shared_data')
                    : path.join(this.botsFolder, botName, 'data');

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
                    logger.error(`   Kod błędu: ${err.code || 'brak'}`);
                    logger.error(`   Ścieżka archiwum: ${archivePath}`);
                    logger.error(`   Ścieżka danych: ${dataFolder}`);
                    if (err.stack) {
                        logger.error(`   Stack trace: ${err.stack}`);
                    }
                    reject(err);
                });

                archive.pipe(output);
                archive.directory(dataFolder, false);
                await archive.finalize();

            } catch (error) {
                logger.error(`❌ Błąd podczas tworzenia archiwum ${botName}:`, error.message);
                logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
                logger.error(`   Kod błędu: ${error.code || 'brak'}`);
                if (error.code === 'ENOSPC') {
                    logger.error(`   Przyczyna: Brak miejsca na dysku`);
                } else if (error.code === 'EACCES' || error.code === 'EPERM') {
                    logger.error(`   Przyczyna: Brak uprawnień do pliku/folderu`);
                } else if (error.code === 'ENOENT') {
                    logger.error(`   Przyczyna: Plik lub folder nie istnieje`);
                }
                if (error.stack) {
                    logger.error(`   Stack trace: ${error.stack}`);
                }
                reject(error);
            }
        });
    }

    /**
     * Sprawdza czy folder Google Drive istnieje, jeśli nie - tworzy go
     * @param {string} folderName - Nazwa folderu
     * @param {string} parentFolderId - ID folderu nadrzędnego (opcjonalne)
     * @returns {Promise<string>} - ID folderu
     */
    async ensureDriveFolder(folderName, parentFolderId = null) {
        try {
            // Buduj query - sprawdź czy folder już istnieje
            let query = `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

            // Jeśli podano parent folder, dodaj do query
            if (parentFolderId) {
                query += ` and '${parentFolderId}' in parents`;
            }

            const response = await this.drive.files.list({
                q: query,
                fields: 'files(id, name)',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            if (response.data.files.length > 0) {
                return response.data.files[0].id;
            }

            // Utwórz folder
            const fileMetadata = {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder'
            };

            // Jeśli podano parent folder, dodaj do metadanych
            if (parentFolderId) {
                fileMetadata.parents = [parentFolderId];
            }

            const folder = await this.drive.files.create({
                resource: fileMetadata,
                fields: 'id',
                supportsAllDrives: true
            });

            logger.info(`📁 Utworzono folder na Google Drive: ${folderName}`);
            return folder.data.id;

        } catch (error) {
            logger.error(`❌ Błąd tworzenia folderu na Google Drive: ${folderName}`, error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);
            logger.error(`   Folder nadrzędny: ${parentFolderId || 'root'}`);

            // Szczegółowe logowanie błędów Google Drive API
            if (error.response) {
                logger.error(`   Status HTTP: ${error.response.status}`);
                logger.error(`   Dane odpowiedzi: ${JSON.stringify(error.response.data || {})}`);
            }
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((err, idx) => {
                    logger.error(`   Błąd API [${idx}]: ${err.message || err.reason || JSON.stringify(err)}`);
                });
            }

            // Klasyfikacja błędów
            if (error.code === 403) {
                logger.error(`   Przyczyna: Brak uprawnień do tworzenia folderu`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                logger.error(`   Przyczyna: Problem z połączeniem sieciowym`);
            }

            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
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
            // Upewnij się, że główny folder backupów istnieje w My Drive
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
                fields: 'id, name, size',
                supportsAllDrives: true
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
            logger.error(`❌ Błąd przesyłania do Google Drive dla ${botName}:`, error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);
            logger.error(`   Plik: ${path.basename(archivePath)}`);

            // Szczegółowe logowanie błędów Google Drive API
            if (error.response) {
                logger.error(`   Status HTTP: ${error.response.status}`);
                logger.error(`   Dane odpowiedzi: ${JSON.stringify(error.response.data || {})}`);
            }
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((err, idx) => {
                    logger.error(`   Błąd API [${idx}]: ${err.message || err.reason || JSON.stringify(err)}`);
                });
            }

            // Klasyfikacja błędów
            if (error.code === 403) {
                logger.error(`   Przyczyna: Brak uprawnień lub przekroczony limit API`);
            } else if (error.code === 404) {
                logger.error(`   Przyczyna: Folder docelowy nie istnieje`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                logger.error(`   Przyczyna: Problem z połączeniem sieciowym`);
            } else if (error.code === 507 || error.message?.includes('storage')) {
                logger.error(`   Przyczyna: Brak miejsca na Google Drive`);
            }

            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
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
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
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
                fields: 'id',
                supportsAllDrives: true
            });

            logger.info(`📁 Utworzono folder bota na Google Drive: ${botName}`);
            return folder.data.id;

        } catch (error) {
            logger.error(`❌ Błąd tworzenia folderu bota ${botName}:`, error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);
            logger.error(`   Folder nadrzędny ID: ${parentFolderId}`);

            // Szczegółowe logowanie błędów Google Drive API
            if (error.response) {
                logger.error(`   Status HTTP: ${error.response.status}`);
                logger.error(`   Dane odpowiedzi: ${JSON.stringify(error.response.data || {})}`);
            }
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((err, idx) => {
                    logger.error(`   Błąd API [${idx}]: ${err.message || err.reason || JSON.stringify(err)}`);
                });
            }

            // Klasyfikacja błędów
            if (error.code === 403) {
                logger.error(`   Przyczyna: Brak uprawnień do tworzenia folderu bota`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                logger.error(`   Przyczyna: Problem z połączeniem sieciowym`);
            }

            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
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
            // Znajdź folder backupów w My Drive
            const backupFolderId = await this.ensureDriveFolder('Polski_Squad_Backups');
            const botFolderId = await this.ensureBotFolder(backupFolderId, botName);

            // Pobierz listę plików w folderze bota
            const response = await this.drive.files.list({
                q: `'${botFolderId}' in parents and trashed=false`,
                fields: 'files(id, name, createdTime)',
                orderBy: 'createdTime desc',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true
            });

            const files = response.data.files;

            // Jeśli mamy więcej niż maxBackupDays plików, usuń najstarsze
            if (files.length > this.maxBackupDays) {
                const filesToDelete = files.slice(this.maxBackupDays);

                for (const file of filesToDelete) {
                    await this.drive.files.delete({
                        fileId: file.id,
                        supportsAllDrives: true
                    });
                    logger.info(`🗑️  Usunięto stary backup z Google Drive: ${file.name}`);
                }
            }

        } catch (error) {
            logger.error(`❌ Błąd czyszczenia starych backupów dla ${botName}:`, error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);

            // Szczegółowe logowanie błędów Google Drive API
            if (error.response) {
                logger.error(`   Status HTTP: ${error.response.status}`);
            }
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((err, idx) => {
                    logger.error(`   Błąd API [${idx}]: ${err.message || err.reason || JSON.stringify(err)}`);
                });
            }

            // Klasyfikacja błędów
            if (error.code === 403) {
                logger.error(`   Przyczyna: Brak uprawnień do usunięcia plików`);
            } else if (error.code === 404) {
                logger.error(`   Przyczyna: Plik do usunięcia nie istnieje`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                logger.error(`   Przyczyna: Problem z połączeniem sieciowym`);
            }

            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
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
                logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
                logger.error(`   Kod błędu: ${error.code || 'brak'}`);

                // Klasyfikacja błędów dla łatwiejszej diagnostyki
                let errorCategory = 'Nieznany';
                if (error.code === 'ENOSPC') {
                    errorCategory = 'Brak miejsca na dysku';
                } else if (error.code === 'EACCES' || error.code === 'EPERM') {
                    errorCategory = 'Brak uprawnień';
                } else if (error.code === 'ENOENT') {
                    errorCategory = 'Plik/folder nie istnieje';
                } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    errorCategory = 'Problem sieciowy';
                } else if (error.code === 403) {
                    errorCategory = 'Brak uprawnień API';
                }
                logger.error(`   Kategoria błędu: ${errorCategory}`);

                if (error.stack) {
                    logger.error(`   Stack trace: ${error.stack}`);
                }

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
                logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
                logger.error(`   Kod błędu: ${error.code || 'brak'}`);
                logger.error(`   Wywołany przez: ${triggerUser}`);

                // Klasyfikacja błędów dla łatwiejszej diagnostyki
                let errorCategory = 'Nieznany';
                if (error.code === 'ENOSPC') {
                    errorCategory = 'Brak miejsca na dysku';
                } else if (error.code === 'EACCES' || error.code === 'EPERM') {
                    errorCategory = 'Brak uprawnień';
                } else if (error.code === 'ENOENT') {
                    errorCategory = 'Plik/folder nie istnieje';
                } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    errorCategory = 'Problem sieciowy';
                } else if (error.code === 403) {
                    errorCategory = 'Brak uprawnień API';
                }
                logger.error(`   Kategoria błędu: ${errorCategory}`);

                if (error.stack) {
                    logger.error(`   Stack trace: ${error.stack}`);
                }

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
            // Upewnij się, że folder Manual_Backups istnieje w My Drive
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
                fields: 'id, name, size',
                supportsAllDrives: true
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
            logger.error(`❌ Błąd przesyłania manualnego backupu do Google Drive dla ${botName}:`, error.message);
            logger.error(`   Typ błędu: ${error.name || 'Unknown'}`);
            logger.error(`   Kod błędu: ${error.code || 'brak'}`);
            logger.error(`   Plik: ${path.basename(archivePath)}`);
            logger.error(`   Wywołany przez: ${triggerUser}`);

            // Szczegółowe logowanie błędów Google Drive API
            if (error.response) {
                logger.error(`   Status HTTP: ${error.response.status}`);
                logger.error(`   Dane odpowiedzi: ${JSON.stringify(error.response.data || {})}`);
            }
            if (error.errors && Array.isArray(error.errors)) {
                error.errors.forEach((err, idx) => {
                    logger.error(`   Błąd API [${idx}]: ${err.message || err.reason || JSON.stringify(err)}`);
                });
            }

            // Klasyfikacja błędów
            if (error.code === 403) {
                logger.error(`   Przyczyna: Brak uprawnień lub przekroczony limit API`);
            } else if (error.code === 404) {
                logger.error(`   Przyczyna: Folder docelowy nie istnieje`);
            } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                logger.error(`   Przyczyna: Problem z połączeniem sieciowym`);
            } else if (error.code === 507 || error.message?.includes('storage')) {
                logger.error(`   Przyczyna: Brak miejsca na Google Drive`);
            }

            if (error.stack) {
                logger.error(`   Stack trace: ${error.stack}`);
            }
            return null;
        }
    }

    // ─────────────────────────────────────────────
    // PRZYWRACANIE USZKODZONYCH PLIKÓW (0B)
    // ─────────────────────────────────────────────

    /**
     * Rekurencyjnie skanuje folder i zwraca pliki o rozmiarze 0 bajtów
     */
    findEmptyFilesSync(folder, baseFolder) {
        const emptyFiles = [];
        const scanDir = (dir) => {
            try {
                const entries = fs.readdirSync(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name);
                    if (entry.isDirectory()) {
                        scanDir(fullPath);
                    } else if (entry.isFile()) {
                        const stat = fs.statSync(fullPath);
                        if (stat.size === 0) {
                            emptyFiles.push({
                                fullPath,
                                relativePath: path.relative(baseFolder, fullPath).replace(/\\/g, '/')
                            });
                        }
                    }
                }
            } catch {}
        };
        scanDir(folder);
        return emptyFiles;
    }

    /**
     * Pobiera najnowszy backup danego bota z Google Drive do pliku tymczasowego
     * @returns {Promise<string|null>} Ścieżka do tymczasowego archiwum lub null
     */
    async downloadLatestBackupFromDrive(botName) {
        if (!this.drive) {
            logger.warn('⚠️  Google Drive nie jest zainicjalizowany — nie można pobrać backupu');
            return null;
        }

        try {
            const backupFolderId = await this.ensureDriveFolder('Polski_Squad_Backups');
            const botFolderId = await this.ensureBotFolder(backupFolderId, botName);

            const response = await this.drive.files.list({
                q: `'${botFolderId}' in parents and trashed=false`,
                fields: 'files(id, name, createdTime)',
                orderBy: 'createdTime desc',
                spaces: 'drive',
                supportsAllDrives: true,
                includeItemsFromAllDrives: true,
                pageSize: 1
            });

            if (!response.data.files.length) {
                logger.warn(`⚠️  Brak backupów dla ${botName} na Google Drive`);
                return null;
            }

            const latestFile = response.data.files[0];
            logger.info(`📥 Pobieranie backupu ${latestFile.name} dla ${botName}...`);

            this.ensureBackupsFolder();
            const tempPath = path.join(this.backupsFolder, `_restore_${botName}_temp.zip`);

            const dest = fs.createWriteStream(tempPath);
            const res = await this.drive.files.get(
                { fileId: latestFile.id, alt: 'media', supportsAllDrives: true },
                { responseType: 'stream' }
            );

            await new Promise((resolve, reject) => {
                res.data.pipe(dest);
                dest.on('finish', resolve);
                dest.on('error', reject);
                res.data.on('error', reject);
            });

            logger.info(`✅ Pobrano backup: ${latestFile.name}`);
            return tempPath;

        } catch (error) {
            logger.error(`❌ Błąd pobierania backupu dla ${botName}:`, error.message);
            return null;
        }
    }

    /**
     * Wyodrębnia wskazane pliki z archiwum ZIP i przywraca je na oryginalne ścieżki.
     * Używa systemowego polecenia `unzip` (dostępnego na serwerach Linux) — brak zewnętrznych zależności.
     * @param {string} archivePath - Ścieżka do archiwum ZIP
     * @param {Array<{fullPath, relativePath}>} filesToRestore
     * @returns {Promise<{restored: string[], notFound: string[]}>}
     */
    /**
     * Etap 1: Skanuje 0B pliki, pobiera backupy i wypakuje je do folderów tymczasowych.
     * Nie modyfikuje żadnych plików produkcyjnych — tylko przygotowuje dane do podglądu.
     * @returns {{ bots, totalEmpty, totalBackupSizeMB }}
     */
    async prepareRestore() {
        const { spawnSync } = require('child_process');
        const os = require('os');

        logger.info('🔍 Skanowanie folderów data pod kątem uszkodzonych plików (0B)...');

        const bots = [];
        let totalEmpty = 0;
        let totalBackupSizeBytes = 0;

        for (const botName of this.bots) {
            const dataFolder = botName === 'shared_data'
                ? path.join(this.botsFolder, 'shared_data')
                : path.join(this.botsFolder, botName, 'data');

            if (!fs.existsSync(dataFolder)) continue;

            const emptyFiles = this.findEmptyFilesSync(dataFolder, dataFolder);
            if (emptyFiles.length === 0) continue;

            totalEmpty += emptyFiles.length;
            logger.warn(`⚠️  ${botName}: znaleziono ${emptyFiles.length} uszkodzonych plików`);
            emptyFiles.forEach(f => logger.warn(`   📄 ${f.relativePath}`));

            const archivePath = await this.downloadLatestBackupFromDrive(botName);
            if (!archivePath) {
                bots.push({ botName, tempDir: null, emptyFiles, recoverableFiles: [], unrecoverableFiles: emptyFiles, backupSizeMB: '0.00', error: 'Brak backupu na Google Drive' });
                continue;
            }

            const archiveSizeBytes = fs.statSync(archivePath).size;
            totalBackupSizeBytes += archiveSizeBytes;
            const backupSizeMB = (archiveSizeBytes / 1024 / 1024).toFixed(2);

            const tempDir = path.join(os.tmpdir(), `restore_${botName}_${Date.now()}`);
            fs.mkdirSync(tempDir, { recursive: true });

            logger.info(`📦 Wypakowuję backup ${botName} (${backupSizeMB} MB) do ${tempDir}...`);
            const result = spawnSync('unzip', ['-o', archivePath, '-d', tempDir], { encoding: 'utf8' });
            try { fs.unlinkSync(archivePath); } catch {}

            if (result.error || (result.status !== 0 && result.status !== 1)) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
                bots.push({ botName, tempDir: null, emptyFiles, recoverableFiles: [], unrecoverableFiles: emptyFiles, backupSizeMB, error: `unzip błąd (kod ${result.status})` });
                continue;
            }

            // Ustal które pliki można przywrócić
            const recoverableFiles = [];
            const unrecoverableFiles = [];
            for (const fileInfo of emptyFiles) {
                const backupFilePath = path.join(tempDir, fileInfo.relativePath);
                if (fs.existsSync(backupFilePath) && fs.statSync(backupFilePath).size > 0) {
                    recoverableFiles.push(fileInfo);
                } else {
                    unrecoverableFiles.push(fileInfo);
                }
            }

            bots.push({ botName, tempDir, emptyFiles, recoverableFiles, unrecoverableFiles, backupSizeMB });
        }

        return {
            bots,
            totalEmpty,
            totalBackupSizeMB: (totalBackupSizeBytes / 1024 / 1024).toFixed(2)
        };
    }

    /**
     * Etap 2: Kopiuje pliki z wypakowanych folderów tymczasowych na ich oryginalne miejsca.
     * Wywołaj po prepareRestore() i po potwierdzeniu przez użytkownika.
     */
    async executeRestore(preparedData) {
        const restored = [];
        const failed = [];

        for (const botData of preparedData.bots) {
            if (botData.error || !botData.tempDir) {
                botData.emptyFiles.forEach(f => failed.push({ bot: botData.botName, file: f.relativePath, reason: botData.error || 'Brak backupu' }));
                continue;
            }

            for (const fileInfo of botData.recoverableFiles) {
                try {
                    await fs.promises.mkdir(path.dirname(fileInfo.fullPath), { recursive: true });
                    fs.copyFileSync(path.join(botData.tempDir, fileInfo.relativePath), fileInfo.fullPath);
                    restored.push({ bot: botData.botName, file: fileInfo.relativePath });
                    logger.info(`✅ Przywrócono: ${botData.botName}/${fileInfo.relativePath}`);
                } catch (error) {
                    failed.push({ bot: botData.botName, file: fileInfo.relativePath, reason: error.message });
                }
            }

            for (const fileInfo of botData.unrecoverableFiles) {
                failed.push({ bot: botData.botName, file: fileInfo.relativePath, reason: 'Nie w backupie lub też 0B' });
            }
        }

        return { restored, failed };
    }

    /**
     * Usuwa wszystkie foldery tymczasowe utworzone przez prepareRestore().
     */
    cleanupRestore(preparedData) {
        for (const botData of preparedData.bots) {
            if (botData.tempDir) {
                try { fs.rmSync(botData.tempDir, { recursive: true, force: true }); } catch {}
            }
        }
        logger.info('🧹 Usunięto foldery tymczasowe przywracania');
    }

    /**
     * Automatyczne przywracanie (używane przez restoreEmptyFiles bez interakcji użytkownika).
     * Wywołuje prepareRestore → executeRestore → cleanupRestore bez pytania o potwierdzenie.
     */
    async restoreEmptyFiles() {
        const preparedData = await this.prepareRestore();

        if (preparedData.totalEmpty === 0) {
            logger.info('✅ Brak uszkodzonych plików (0B) — wszystko OK');
            return { restored: [], failed: [] };
        }

        logger.warn(`⚠️  Łącznie ${preparedData.totalEmpty} uszkodzonych plików — przywracam automatycznie...`);

        const { restored, failed } = await this.executeRestore(preparedData);
        this.cleanupRestore(preparedData);

        logger.info(`✅ Zakończono: ${restored.length} przywrócono, ${failed.length} błędów`);
        await this.sendRestoreSummaryToWebhook(restored, failed);

        return { restored, failed };
    }

    /**
     * Wysyła podsumowanie przywracania plików na webhook backupu
     */
    async sendRestoreSummaryToWebhook(restored, failed) {
        const webhookUrl = process.env.DISCORD_LOG_WEBHOOK_URL_BACKUP || process.env.DISCORD_LOG_WEBHOOK_URL;
        if (!webhookUrl) return;

        const OWNER_PING = '<@398983446812295168>';

        const timestamp = new Date().toLocaleString('pl-PL', {
            timeZone: 'Europe/Warsaw',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });

        let msg = `${OWNER_PING}\n🔄 **AUTO-PRZYWRACANIE Z BACKUPU**\n\n`;
        msg += `**${restored.length} przywrócono, ${failed.length} błędów**\n\n`;

        if (restored.length > 0) {
            msg += restored.map(r => `✅ \`${r.bot}/${r.file}\``).join('\n');
            msg += '\n';
        }

        if (failed.length > 0) {
            if (restored.length > 0) msg += '\n';
            msg += failed.map(f => `❌ \`${f.bot}/${f.file}\` — ${f.reason}`).join('\n');
            msg += '\n';
        }

        msg += `\n🕐 ${timestamp}`;

        // Discord limit 2000 znaków
        if (msg.length > 2000) {
            msg = msg.substring(0, 1950) + '\n…(lista skrócona)\n\n🕐 ' + timestamp;
        }

        try {
            const data = JSON.stringify({ content: msg });
            const url = new URL(webhookUrl);
            const options = {
                hostname: url.hostname,
                path: url.pathname,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
            };

            await new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    res.statusCode >= 200 && res.statusCode < 300 ? resolve() : reject(new Error(`Status: ${res.statusCode}`));
                });
                req.on('error', reject);
                req.write(data);
                req.end();
            });
        } catch (error) {
            logger.error('❌ Błąd wysyłania podsumowania przywracania na webhook:', error.message);
        }
    }
}

module.exports = BackupManager;
