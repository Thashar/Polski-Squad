const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const logger = createBotLogger('Stalker');

class PhaseService {
    constructor(config, databaseService, ocrService, client) {
        this.config = config;
        this.databaseService = databaseService;
        this.ocrService = ocrService;
        this.client = client;
        this.activeSessions = new Map(); // sessionId → session data
        this.tempDir = path.join(__dirname, '..', 'temp', 'phase1');
        this.activeProcessing = new Map(); // guildId → userId (kto obecnie przetwarza)
        this.waitingQueue = new Map(); // guildId → [{userId, addedAt}] (uporządkowana kolejka FIFO)
        this.queueReservation = new Map(); // guildId → {userId, expiresAt, timeout} (rezerwacja dla pierwszej osoby)
    }

    /**
     * Sprawdza czy ktoś obecnie przetwarza w danym guild
     */
    isProcessingActive(guildId) {
        return this.activeProcessing.has(guildId);
    }

    /**
     * Pobiera ID użytkownika który obecnie przetwarza
     */
    getActiveProcessor(guildId) {
        return this.activeProcessing.get(guildId);
    }

    /**
     * Ustawia aktywne przetwarzanie
     */
    setActiveProcessing(guildId, userId) {
        this.activeProcessing.set(guildId, userId);
        logger.info(`[PHASE1] 🔒 Użytkownik ${userId} zablokował przetwarzanie dla guild ${guildId}`);
    }

    /**
     * Dodaje użytkownika do kolejki czekających
     */
    async addToWaitingQueue(guildId, userId) {
        if (!this.waitingQueue.has(guildId)) {
            this.waitingQueue.set(guildId, []);
        }

        const queue = this.waitingQueue.get(guildId);

        // Sprawdź czy użytkownik już jest w kolejce
        if (queue.find(item => item.userId === userId)) {
            logger.warn(`[QUEUE] ⚠️ Użytkownik ${userId} jest już w kolejce dla guild ${guildId}`);
            return;
        }

        queue.push({ userId, addedAt: Date.now() });
        const position = queue.length;

        logger.info(`[QUEUE] ➕ Użytkownik ${userId} dodany do kolejki (pozycja: ${position}) dla guild ${guildId}`);

    }

    /**
     * Usuwa aktywne przetwarzanie i powiadamia czekających
     */
    async clearActiveProcessing(guildId) {
        this.activeProcessing.delete(guildId);
        logger.info(`[PHASE] 🔓 Odblokowano przetwarzanie dla guild ${guildId}`);

        // Sprawdź czy są osoby w kolejce
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);

            if (queue.length > 0) {
                // Pobierz pierwszą osobę z kolejki
                const nextPerson = queue[0];
                logger.info(`[QUEUE] 📢 Następna osoba w kolejce: ${nextPerson.userId}`);

                // Stwórz rezerwację na 5 minut
                await this.createQueueReservation(guildId, nextPerson.userId);

                // Powiadom pozostałe osoby w kolejce o zmianie pozycji
                for (let i = 1; i < queue.length; i++) {
                    await this.notifyQueuePosition(guildId, queue[i].userId, i);
                }
            } else {
                // Brak osób w kolejce - wyczyść
                this.waitingQueue.delete(guildId);
            }
        }
    }

    /**
     * Tworzy rezerwację dla pierwszej osoby w kolejce (5 min)
     */
    async createQueueReservation(guildId, userId) {
        // Wyczyść poprzednią rezerwację jeśli istnieje
        if (this.queueReservation.has(guildId)) {
            const oldReservation = this.queueReservation.get(guildId);
            if (oldReservation.timeout) {
                clearTimeout(oldReservation.timeout);
            }
        }

        const expiresAt = Date.now() + (3 * 60 * 1000); // 3 minuty

        // Timeout który usuwa rezerwację i powiadamia następną osobę
        const timeout = setTimeout(async () => {
            logger.warn(`[QUEUE] ⏰ Rezerwacja wygasła dla użytkownika ${userId}`);
            await this.expireReservation(guildId, userId);
        }, 3 * 60 * 1000);

        this.queueReservation.set(guildId, { userId, expiresAt, timeout });

        // Powiadom użytkownika że może użyć komendy
        try {
            const user = await this.client.users.fetch(userId);
            const expiryTimestamp = Math.floor(expiresAt / 1000);
            await user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('✅ Twoja kolej!')
                    .setDescription(`Możesz teraz użyć komendy \`/faza1\` lub \`/faza2\`.\n\n⏱️ Masz czas do: <t:${expiryTimestamp}:R>\n\n⚠️ **Jeśli nie użyjesz komendy w ciągu 3 minut, Twoja kolej przepadnie.**`)
                    .setColor('#00FF00')
                    .setTimestamp()
                ]
            });
            logger.info(`[QUEUE] ✅ Powiadomiono użytkownika ${userId} o jego kolejce`);
        } catch (error) {
            logger.error(`[QUEUE] ❌ Nie udało się powiadomić użytkownika ${userId}:`, error.message);
        }
    }

    /**
     * Wygasa rezerwację i przechodzi do następnej osoby
     */
    async expireReservation(guildId, userId) {
        // Usuń rezerwację
        this.queueReservation.delete(guildId);

        // Usuń użytkownika z kolejki
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);
            const index = queue.findIndex(item => item.userId === userId);

            if (index !== -1) {
                queue.splice(index, 1);
                logger.info(`[QUEUE] ➖ Użytkownik ${userId} usunięty z kolejki (timeout)`);

                // Powiadom użytkownika że stracił kolejkę
                try {
                    const user = await this.client.users.fetch(userId);
                    await user.send({
                        embeds: [new EmbedBuilder()
                            .setTitle('⏰ Czas minął')
                            .setDescription('Nie użyłeś komendy w ciągu 3 minut. Twoja kolej przepadła.\n\nMożesz użyć komendy ponownie, aby dołączyć na koniec kolejki.')
                            .setColor('#FF0000')
                            .setTimestamp()
                        ]
                    });
                } catch (error) {
                    logger.error(`[QUEUE] ❌ Nie udało się powiadomić użytkownika ${userId} o wygaśnięciu:`, error.message);
                }
            }

            // Powiadom następną osobę jeśli jest
            if (queue.length > 0) {
                const nextPerson = queue[0];
                await this.createQueueReservation(guildId, nextPerson.userId);

                // WYŁĄCZONE: Powiadamianie pozostałych osób o zmianie pozycji
            } else {
                this.waitingQueue.delete(guildId);
            }
        }
    }

    /**
     * Powiadamia użytkownika o jego pozycji w kolejce
     */
    async notifyQueuePosition(guildId, userId, position) {
        try {
            const guild = await this.client.guilds.fetch(guildId);
            const user = await this.client.users.fetch(userId);
            const activeUserId = this.activeProcessing.get(guildId);

            let description = `Twoja pozycja w kolejce: **${position}**\n\n`;

            if (activeUserId) {
                try {
                    const activeMember = await guild.members.fetch(activeUserId);
                    description += `🔒 Obecnie używa: **${activeMember.displayName}**\n`;
                } catch (err) {
                    description += `🔒 Obecnie system jest zajęty\n`;
                }
            }

            // Dodaj informację o osobach przed użytkownikiem
            if (this.waitingQueue.has(guildId)) {
                const queue = this.waitingQueue.get(guildId);
                const peopleAhead = queue.slice(0, position - 1);

                if (peopleAhead.length > 0) {
                    description += `\n👥 Przed Tobą w kolejce:\n`;
                    for (let i = 0; i < Math.min(peopleAhead.length, 3); i++) {
                        try {
                            const personMember = await guild.members.fetch(peopleAhead[i].userId);
                            description += `${i + 1}. **${personMember.displayName}**\n`;
                        } catch (err) {
                            description += `${i + 1}. *Użytkownik*\n`;
                        }
                    }

                    if (peopleAhead.length > 3) {
                        description += `... i ${peopleAhead.length - 3} innych\n`;
                    }
                }
            }

            description += `\n✅ Dostaniesz powiadomienie, gdy będzie Twoja kolej.`;

            await user.send({
                embeds: [new EmbedBuilder()
                    .setTitle('📋 Jesteś w kolejce')
                    .setDescription(description)
                    .setColor('#FFA500')
                    .setTimestamp()
                ]
            });

            logger.info(`[QUEUE] 📬 Powiadomiono użytkownika ${userId} o pozycji ${position}`);
        } catch (error) {
            logger.error(`[QUEUE] ❌ Nie udało się powiadomić użytkownika ${userId} o pozycji:`, error.message);
        }
    }

    /**
     * Sprawdza czy użytkownik ma rezerwację
     */
    hasReservation(guildId, userId) {
        if (!this.queueReservation.has(guildId)) {
            return false;
        }
        const reservation = this.queueReservation.get(guildId);
        return reservation.userId === userId && reservation.expiresAt > Date.now();
    }

    /**
     * Pobiera informacje o kolejce dla użytkownika (do wyświetlenia w kanale)
     */
    async getQueueInfo(guildId, userId) {
        const guild = await this.client.guilds.fetch(guildId);
        const activeUserId = this.activeProcessing.get(guildId);
        const queue = this.waitingQueue.get(guildId) || [];
        const userIndex = queue.findIndex(item => item.userId === userId);
        const position = userIndex + 1;

        let description = '';

        // Informacja o osobie obecnie używającej
        if (activeUserId) {
            try {
                const activeMember = await guild.members.fetch(activeUserId);
                description += `🔒 **Obecnie używa:** ${activeMember.displayName}\n\n`;
            } catch (err) {
                description += `🔒 **System jest obecnie zajęty**\n\n`;
            }
        }

        // Pozycja użytkownika
        description += `📋 **Twoja pozycja w kolejce:** ${position}\n`;
        description += `👥 **Łącznie osób w kolejce:** ${queue.length}\n\n`;

        // Lista osób przed użytkownikiem
        const peopleAhead = queue.slice(0, userIndex);
        if (peopleAhead.length > 0) {
            description += `**Osoby przed Tobą:**\n`;
            const displayLimit = Math.min(peopleAhead.length, 3);

            for (let i = 0; i < displayLimit; i++) {
                try {
                    const personMember = await guild.members.fetch(peopleAhead[i].userId);
                    description += `${i + 1}. ${personMember.displayName}\n`;
                } catch (err) {
                    description += `${i + 1}. *Użytkownik*\n`;
                }
            }

            if (peopleAhead.length > 3) {
                description += `... i ${peopleAhead.length - 3} innych\n`;
            }
            description += `\n`;
        }

        description += `✅ **Dostaniesz powiadomienie na priv** gdy będzie Twoja kolej.`;

        return { description, position, queueLength: queue.length };
    }

    /**
     * Usuwa użytkownika z kolejki po użyciu komendy
     */
    removeFromQueue(guildId, userId) {
        // Wyczyść rezerwację
        if (this.queueReservation.has(guildId)) {
            const reservation = this.queueReservation.get(guildId);
            if (reservation.userId === userId) {
                if (reservation.timeout) {
                    clearTimeout(reservation.timeout);
                }
                this.queueReservation.delete(guildId);
                logger.info(`[QUEUE] ✅ Usunięto rezerwację dla użytkownika ${userId}`);
            }
        }

        // Usuń z kolejki
        if (this.waitingQueue.has(guildId)) {
            const queue = this.waitingQueue.get(guildId);
            const index = queue.findIndex(item => item.userId === userId);

            if (index !== -1) {
                queue.splice(index, 1);
                logger.info(`[QUEUE] ➖ Użytkownik ${userId} usunięty z kolejki (rozpoczął używanie)`);
            }

            if (queue.length === 0) {
                this.waitingQueue.delete(guildId);
            }
        }
    }

    /**
     * Inicjalizuje folder tymczasowy
     */
    async initTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            logger.error('[PHASE1] ❌ Błąd tworzenia folderu temp:', error);
        }
    }

    /**
     * Pobiera zdjęcie z URL i zapisuje lokalnie
     */
    async downloadImage(url, sessionId, index) {
        await this.initTempDir();

        const filename = `${sessionId}_${index}_${Date.now()}.png`;
        const filepath = path.join(this.tempDir, filename);

        return new Promise((resolve, reject) => {
            https.get(url, (response) => {
                const fileStream = require('fs').createWriteStream(filepath);
                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    logger.info(`[PHASE1] 💾 Zapisano zdjęcie: ${filename}`);
                    resolve(filepath);
                });

                fileStream.on('error', (err) => {
                    reject(err);
                });
            }).on('error', (err) => {
                reject(err);
            });
        });
    }

    /**
     * Usuwa pliki sesji z temp
     */
    async cleanupSessionFiles(sessionId) {
        try {
            const files = await fs.readdir(this.tempDir);
            const sessionFiles = files.filter(f => f.startsWith(sessionId));

            for (const file of sessionFiles) {
                const filepath = path.join(this.tempDir, file);
                await fs.unlink(filepath);
                logger.info(`[PHASE1] 🗑️ Usunięto plik: ${file}`);
            }
        } catch (error) {
            logger.error('[PHASE1] ❌ Błąd czyszczenia plików sesji:', error);
        }
    }

    /**
     * Tworzy nową sesję Fazy 1
     */
    createSession(userId, guildId, channelId, phase = 1, ocrExpiresAt = null) {
        const sessionId = `${userId}_${Date.now()}`;

        const session = {
            sessionId,
            userId,
            guildId,
            channelId,
            phase, // 1 lub 2
            currentRound: 1, // dla fazy 2: 1, 2 lub 3
            roundsData: [], // dla fazy 2: dane z każdej rundy
            processedImages: [], // [{imageUrl, results: [{nick, score}]}]
            aggregatedResults: new Map(), // nick → [scores]
            conflicts: [], // [{nick, values: [{value, count}]}]
            resolvedConflicts: new Map(), // nick → finalScore
            stage: 'awaiting_images', // 'awaiting_images' | 'confirming_complete' | 'resolving_conflicts' | 'final_confirmation'
            createdAt: Date.now(),
            timeout: null,
            downloadedFiles: [], // ścieżki do pobranych plików
            messageToDelete: null, // wiadomość ze zdjęciami do usunięcia
            publicInteraction: null, // interakcja do aktualizacji postępu (PUBLICZNA)
            roleNicksSnapshotPath: null, // ścieżka do snapshotu nicków z roli
            isProcessing: false, // flaga czy aktualnie przetwarza zdjęcia (blokuje anulowanie)
            cancelled: false, // flaga czy sesja została anulowana (do sprawdzania w pętli)
            ocrExpiresAt // timestamp wygaśnięcia sesji OCR (z kolejki OCR)
        };

        this.activeSessions.set(sessionId, session);

        // Auto-cleanup po 15 minutach
        session.timeout = setTimeout(async () => {
            logger.info(`[PHASE${phase}] ⏰ Sesja wygasła przez timeout: ${sessionId}`);

            // Zatrzymaj pingTimer przed cleanup (dodatkowe zabezpieczenie)
            if (session.pingTimer) {
                clearInterval(session.pingTimer);
                session.pingTimer = null;
                logger.info(`[PHASE${phase}] ⏹️ Zatrzymano ghost ping przy timeout sesji: ${sessionId}`);
            }

            await this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);

        logger.info(`[PHASE${phase}] 📝 Utworzono sesję: ${sessionId}`);
        return sessionId;
    }

    /**
     * Pobiera sesję użytkownika
     */
    getSession(sessionId) {
        return this.activeSessions.get(sessionId);
    }

    /**
     * Pobiera sesję użytkownika po userId (ostatnia aktywna)
     */
    getSessionByUserId(userId) {
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (session.userId === userId) {
                return session;
            }
        }
        return null;
    }

    /**
     * Odnawia timeout sesji
     */
    refreshSessionTimeout(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        if (session.timeout) {
            clearTimeout(session.timeout);
        }

        session.timeout = setTimeout(async () => {
            logger.info(`[PHASE${session.phase || 1}] ⏰ Sesja wygasła przez timeout: ${sessionId}`);

            // Zatrzymaj pingTimer przed cleanup (dodatkowe zabezpieczenie)
            if (session.pingTimer) {
                clearInterval(session.pingTimer);
                session.pingTimer = null;
                logger.info(`[PHASE${session.phase || 1}] ⏹️ Zatrzymano ghost ping przy timeout sesji: ${sessionId}`);
            }

            await this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);
    }

    /**
     * Usuwa sesję
     */
    async cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        logger.info(`[PHASE${session.phase || 1}] 🧹 Rozpoczynam czyszczenie sesji: ${sessionId}`);

        // Jeśli sesja jest w trakcie przetwarzania, tylko ustaw flagę cancelled
        if (session.isProcessing) {
            logger.warn(`[PHASE${session.phase || 1}] ⚠️ Sesja jest w trakcie przetwarzania - ustawiam flagę cancelled`);
            session.cancelled = true;
            return; // Pętla przetwarzania sama się zatrzyma i wyczyści
        }

        if (session.timeout) {
            clearTimeout(session.timeout);
            session.timeout = null;
        }

        // Zatrzymaj timer ghost pingów jeśli istnieje
        if (session.pingTimer) {
            clearInterval(session.pingTimer);
            session.pingTimer = null;
            logger.info(`[PHASE${session.phase || 1}] ⏹️ Zatrzymano timer ghost pingów dla sesji: ${sessionId}`);
        }

        // Zatrzymaj timer migania jeśli istnieje
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info(`[PHASE${session.phase || 1}] ⏹️ Zatrzymano timer migania dla sesji: ${sessionId}`);
        }

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

        // Usuń snapshot nicków jeśli istnieje
        if (session.roleNicksSnapshotPath) {
            await this.ocrService.deleteRoleNicksSnapshot(session.roleNicksSnapshotPath);
            session.roleNicksSnapshotPath = null;
        }

        // Wyczyść duże struktury danych z pamięci
        if (session.processedImages) {
            session.processedImages.length = 0;
            session.processedImages = null;
        }
        if (session.aggregatedResults) {
            session.aggregatedResults.clear();
            session.aggregatedResults = null;
        }
        if (session.conflicts) {
            session.conflicts.length = 0;
            session.conflicts = null;
        }
        if (session.resolvedConflicts) {
            session.resolvedConflicts.clear();
            session.resolvedConflicts = null;
        }
        if (session.roundsData) {
            session.roundsData.length = 0;
            session.roundsData = null;
        }
        if (session.downloadedFiles) {
            session.downloadedFiles.length = 0;
            session.downloadedFiles = null;
        }

        // Odblokuj przetwarzanie dla tego guild (ghost ping queue)
        await this.clearActiveProcessing(session.guildId);

        // KRYTYCZNE: Zakończ sesję OCR w kolejce (zapobiega deadlockowi)
        if (this.ocrService && session.guildId && session.userId) {
            await this.ocrService.endOCRSession(session.guildId, session.userId, true);
            logger.info(`[PHASE${session.phase || 1}] 🔓 Zwolniono kolejkę OCR dla użytkownika ${session.userId}`);
        }

        // Usuń sesję z mapy
        this.activeSessions.delete(sessionId);

        // Wymuś garbage collection jeśli dostępne (tylko w trybie --expose-gc)
        if (global.gc) {
            global.gc();
            logger.info(`[PHASE${session.phase || 1}] 🗑️ Sesja wyczyszczona, GC wywołany: ${sessionId}`);
        } else {
            logger.info(`[PHASE${session.phase || 1}] 🗑️ Sesja wyczyszczona: ${sessionId}`);
        }
    }

    /**
     * Przetwarza zdjęcia z dysku (już pobrane)
     */
    async processImagesFromDisk(sessionId, downloadedFiles, guild, member, publicInteraction) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        // Ustaw flagę przetwarzania
        session.isProcessing = true;
        session.publicInteraction = publicInteraction;

        // Inicjalizuj stan migania
        session.blinkState = false;
        session.isUpdatingProgress = false; // Flaga zapobiegająca nakładaniu się wywołań

        // Uruchom timer migania (co 1 sekundę)
        session.blinkTimer = setInterval(async () => {
            // Pomiń jeśli poprzednie wywołanie się jeszcze nie zakończyło
            if (session.isUpdatingProgress) {
                return;
            }

            session.blinkState = !session.blinkState;

            // Aktualizuj embed jeśli jest w trakcie przetwarzania
            if (session.publicInteraction && session.currentProcessingImage) {
                try {
                    session.isUpdatingProgress = true;
                    await this.updateProgress(session, session.currentProcessingImage);
                } catch (error) {
                    logger.error('[PHASE] ❌ Błąd aktualizacji migania:', error.message);
                } finally {
                    session.isUpdatingProgress = false;
                }
            }
        }, 1000);

        logger.info(`[PHASE1] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        // Odśwież cache członków przed przetwarzaniem
        await safeFetchMembers(guild, logger);

        // Utwórz snapshot nicków z roli na początku
        const snapshotPath = path.join(this.tempDir, `role_nicks_snapshot_${sessionId}.json`);
        const snapshotCreated = await this.ocrService.saveRoleNicksSnapshot(guild, member, snapshotPath);

        if (snapshotCreated) {
            session.roleNicksSnapshotPath = snapshotPath;
            logger.info(`[PHASE1] ✅ Snapshot nicków utworzony: ${snapshotPath}`);
        } else {
            logger.warn(`[PHASE1] ⚠️ Nie udało się utworzyć snapshotu - będzie używane pobieranie na żywo`);
        }

        const results = [];
        const totalImages = downloadedFiles.length;

        // Zaktualizuj embed na progress bar przed rozpoczęciem przetwarzania
        await this.updateProgress(session, {
            currentImage: 0,
            totalImages: totalImages,
            stage: 'loading',
            action: 'Przygotowuję do przetworzenia zdjęć...'
        });

        for (let i = 0; i < downloadedFiles.length; i++) {
            // Sprawdź czy sesja została anulowana
            if (session.cancelled) {
                logger.warn(`[PHASE${session.phase}] ⚠️ Sesja została anulowana podczas przetwarzania - przerywam pętlę`);
                break;
            }

            // Sprawdź czy struktury danych nadal istnieją (dodatkowe zabezpieczenie)
            if (!session.processedImages || !session.aggregatedResults) {
                logger.error(`[PHASE${session.phase}] ❌ Struktury danych sesji zostały zniszczone - przerywam przetwarzanie`);
                break;
            }

            const fileData = downloadedFiles[i];
            const attachment = fileData.originalAttachment;

            try {
                // Zapisz aktualnie przetwarzane zdjęcie (dla migania)
                session.currentProcessingImage = {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'loading',
                    action: 'Ładowanie zdjęcia'
                };
                // Miganie w setInterval automatycznie pokaże ten stan

                logger.info(`[PHASE1] 📷 Przetwarzanie zdjęcia ${i + 1}/${totalImages}: ${attachment.name}`);

                // Zmiana stanu na OCR
                session.currentProcessingImage = {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'ocr',
                    action: 'Rozpoznawanie tekstu (OCR)'
                };
                // Miganie w setInterval automatycznie pokaże ten stan

                // Przetwórz OCR z pliku lokalnego
                const text = await this.ocrService.processImageFromFile(fileData.filepath);

                // Zmiana stanu na ekstrakcję
                session.currentProcessingImage = {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'extracting',
                    action: 'Wyciąganie wyników graczy'
                };
                // Miganie w setInterval automatycznie pokaże ten stan

                // Wyciągnij wszystkich graczy z wynikami (nie tylko zerami)
                // Użyj snapshotu jeśli istnieje
                const playersWithScores = await this.ocrService.extractAllPlayersWithScores(
                    text,
                    guild,
                    member,
                    session.roleNicksSnapshotPath
                );

                results.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    results: playersWithScores
                });

                // Dodaj do sesji
                session.processedImages.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    results: playersWithScores
                });

                // Zmiana stanu na agregację
                session.currentProcessingImage = {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'aggregating',
                    action: 'Agregacja wyników'
                };
                // Miganie w setInterval automatycznie pokaże ten stan

                // Tymczasowa agregacja dla statystyk postępu
                this.aggregateResults(session);

                logger.info(`[PHASE1] ✅ Znaleziono ${playersWithScores.length} graczy na zdjęciu ${i + 1}`);
            } catch (error) {
                logger.error(`[PHASE1] ❌ Błąd przetwarzania zdjęcia ${i + 1}:`, error);
                results.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    error: error.message,
                    results: []
                });

                session.processedImages.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    error: error.message,
                    results: []
                });
            }
        }

        // Finalna agregacja
        this.aggregateResults(session);

        // Zatrzymaj timer migania
        if (session.blinkTimer) {
            clearInterval(session.blinkTimer);
            session.blinkTimer = null;
            logger.info('[PHASE] ⏹️ Zatrzymano timer migania');
        }

        // Poczekaj na zakończenie ostatniego wywołania updateProgress (race condition fix)
        let waitCount = 0;
        while (session.isUpdatingProgress && waitCount < 50) {
            await new Promise(resolve => setTimeout(resolve, 100)); // 100ms
            waitCount++;
        }
        if (waitCount > 0) {
            logger.info(`[PHASE] ✅ Zakończono oczekiwanie na ostatnią aktualizację progress (${waitCount * 100}ms)`);
        }

        // Wyczyść aktualnie przetwarzane zdjęcie
        session.currentProcessingImage = null;

        // Wyłącz flagę przetwarzania
        session.isProcessing = false;

        // Jeśli sesja została anulowana podczas przetwarzania, wyczyść ją teraz
        if (session.cancelled) {
            logger.info(`[PHASE${session.phase}] 🧹 Sesja została anulowana - czyszczę po zakończeniu przetwarzania`);

            // Zaktualizuj embed na Discordzie do stanu "Anulowano" przed cleanup
            const cancelledInteraction = session.publicInteraction;
            if (cancelledInteraction) {
                try {
                    const cancelledEmbed = new EmbedBuilder()
                        .setTitle('❌ Sesja anulowana')
                        .setDescription('Przetwarzanie zostało anulowane przez użytkownika.')
                        .setColor('#FF0000')
                        .setTimestamp();

                    if (cancelledInteraction.editReply) {
                        await cancelledInteraction.editReply({ embeds: [cancelledEmbed], components: [] });
                    } else {
                        await cancelledInteraction.edit({ embeds: [cancelledEmbed], components: [] });
                    }
                } catch (err) {
                    logger.warn(`[PHASE${session.phase}] ⚠️ Nie udało się zaktualizować embeda po anulowaniu: ${err.message}`);
                }
            }

            await this.cleanupSession(sessionId);
        }

        return results;
    }

    /**
     * Aktualizuje postęp w publicznej wiadomości
     */
    async updateProgress(session, progress) {
        if (!session.publicInteraction) return;

        try {
            const { currentImage, totalImages, stage, action } = progress;
            const percent = Math.round((currentImage / totalImages) * 100);

            // Oblicz statystyki
            const uniqueNicks = session.aggregatedResults.size;
            const confirmedResults = Array.from(session.aggregatedResults.values())
                .filter(scores => scores.length >= 2 && new Set(scores).size === 1).length;
            const unconfirmedResults = uniqueNicks - confirmedResults;

            // Oblicz konflikty - nicki z różnymi wartościami
            const conflictsCount = Array.from(session.aggregatedResults.values())
                .filter(scores => new Set(scores).size > 1).length;

            // Oblicz graczy z zerem - TYLKO gdy wszystkie wartości to 0 (brak konfliktu)
            const playersWithZero = Array.from(session.aggregatedResults.entries())
                .filter(([nick, scores]) => {
                    const uniqueScores = [...new Set(scores)];
                    // Zlicz tylko gdy NIE MA konfliktu i wszystkie wartości to 0
                    return uniqueScores.length === 1 && (uniqueScores[0] === 0 || uniqueScores[0] === '0');
                })
                .length;

            const progressBar = this.createProgressBar(currentImage, totalImages, stage, session.blinkState || false);

            // Ikony dla różnych etapów
            const stageIcons = {
                'loading': '📥',
                'ocr': '🔍',
                'extracting': '📊',
                'aggregating': '🔄'
            };
            const icon = stageIcons[stage] || '⚙️';

            const phaseTitle = session.phase === 2 ? 'Faza 2' : 'Faza 1';
            const roundText = session.phase === 2 ? ` - Runda ${session.currentRound}/3` : '';

            const embed = new EmbedBuilder()
                .setTitle(`🔄 Przetwarzanie zdjęć - ${phaseTitle}${roundText}`)
                .setDescription(`${progressBar}\n\n📸 Przetwarzam zdjęcie **${currentImage}/${totalImages}**...\n${icon} ${action}`)
                .setColor('#FFA500')
                .addFields(
                    { name: '👥 Unikalnych nicków', value: uniqueNicks.toString(), inline: true },
                    { name: '✅ Potwierdzone', value: confirmedResults.toString(), inline: true },
                    { name: '❓ Niepotwierdzone', value: unconfirmedResults.toString(), inline: true },
                    { name: '⚠️ Konflikty', value: conflictsCount.toString(), inline: true },
                    { name: '🥚 Graczy z zerem', value: playersWithZero.toString(), inline: true }
                );

            // Dodaj timestamp OCR jeśli dostępny
            if (session.ocrExpiresAt) {
                const ocrExpiryTimestamp = Math.floor(session.ocrExpiresAt / 1000);
                embed.addFields(
                    { name: '⏱️ OCR wygasa', value: `<t:${ocrExpiryTimestamp}:R>`, inline: true }
                );
            }

            embed.setTimestamp()
                .setFooter({ text: 'Przetwarzanie...' });

            // Spróbuj zaktualizować - obsługuje zarówno Interaction jak i Message
            try {
                if (session.publicInteraction.editReply) {
                    // To jest Interaction
                    await session.publicInteraction.editReply({
                        embeds: [embed]
                    });
                } else {
                    // To jest Message
                    await session.publicInteraction.edit({
                        embeds: [embed]
                    });
                }
            } catch (editError) {
                // Wiadomość postępu usunięta - kontynuuj przetwarzanie bez aktualizacji postępu
                if (editError.code === 10008 || editError.message?.includes('Unknown Message')) {
                    logger.warn('[PHASE] ⚠️ Wiadomość postępu usunięta - kontynuuję przetwarzanie bez aktualizacji postępu');
                    // Nie przerywaj - index.js wyśle nową wiadomość po zakończeniu
                // Interakcja wygasła - anuluj sesję i odblokuj kolejkę
                } else if (editError.code === 10015 || editError.message?.includes('Unknown Webhook') || editError.message?.includes('Invalid Webhook Token')) {
                    logger.warn('[PHASE] ⏰ Interakcja wygasła, anuluję sesję i odblokowuję kolejkę');

                    // Wyślij informację do kanału
                    try {
                        const channel = await this.client.channels.fetch(session.channelId);
                        if (channel) {
                            await channel.send({
                                embeds: [new EmbedBuilder()
                                    .setTitle('⏰ Sesja wygasła')
                                    .setDescription('❌ Sesja wygasła z powodu braku aktywności. Spróbuj ponownie.\n\nInterakcja Discord wygasła (max 15 minut). Dane nie zostały zapisane.')
                                    .setColor('#FF0000')
                                    .setTimestamp()
                                ]
                            });
                        }
                    } catch (channelError) {
                        logger.error('[PHASE] Nie udało się wysłać informacji o wygaśnięciu sesji:', channelError.message);
                    }

                    // Wyczyść sesję i odblokuj przetwarzanie
                    await this.cleanupSession(session.sessionId);
                    this.clearActiveProcessing(session.guildId);

                    return; // Przerwij przetwarzanie
                } else {
                    throw editError;
                }
            }
        } catch (error) {
            logger.error('[PHASE] ❌ Błąd aktualizacji postępu:', error.message);
        }
    }

    /**
     * Tworzy pasek postępu z emoji (stałe 10 kratek + procent)
     */
    createProgressBar(currentImage, totalImages, stage = 'pending', blinkState = false) {
        // Oblicz procenty: pokazuj ile zdjęć zostało ZAKOŃCZONYCH
        // Podczas przetwarzania zdjęcia N pokazuj procent za (N-1) zakończonych zdjęć
        const isFullyCompleted = currentImage === totalImages && stage !== 'loading' && stage !== 'ocr' && stage !== 'extracting' && stage !== 'aggregating';
        const percentage = isFullyCompleted
            ? 100
            : Math.floor(((currentImage - 1) / totalImages) * 100);
        const totalBars = 10;

        let bar = '';

        if (currentImage === 0) {
            // Początek - wszystkie białe kratki
            bar = '⬜'.repeat(totalBars);
        } else if (isFullyCompleted) {
            // Wszystko ukończone - 10 zielonych kratek
            bar = '🟩'.repeat(totalBars);
        } else {
            // Oblicz ile kratek reprezentuje ukończone zdjęcia
            const greenBars = Math.floor(((currentImage - 1) / totalImages) * totalBars);
            // Oblicz ile kratek reprezentuje aktualnie przetwarzane zdjęcie
            const completedBars = Math.ceil((currentImage / totalImages) * totalBars);
            const orangeBars = completedBars - greenBars;
            const remainingBars = totalBars - completedBars;

            // Sprawdź czy to etap "po przetworzeniu" (aggregating, completed)
            const isProcessingStage = stage === 'loading' || stage === 'ocr' || stage === 'extracting';

            if (!isProcessingStage) {
                // Po przetworzeniu (aggregating/completed) - wszystkie kratki (zielone + pomarańczowe) stają się zielone
                // Zapewnia że: jeśli migały X kratek → X kratek staje się zielonych
                bar = '🟩'.repeat(greenBars + orangeBars) + '⬜'.repeat(remainingBars);
            } else {
                // Podczas przetwarzania (loading/ocr/extracting)
                // Zielone kratki = postęp ukończonych zdjęć (currentImage - 1)
                // Pomarańczowe/białe kratki = postęp obecnego zdjęcia (migają co sekundę)
                const currentBar = blinkState ? '🟧' : '⬜';
                bar = '🟩'.repeat(greenBars) + currentBar.repeat(orangeBars) + '⬜'.repeat(remainingBars);
            }
        }

        return `${bar} ${percentage}%`;
    }

    /**
     * Agreguje wyniki ze wszystkich zdjęć
     */
    aggregateResults(session) {
        session.aggregatedResults.clear();

        for (const imageData of session.processedImages) {
            if (imageData.error) continue;

            for (const player of imageData.results) {
                const nick = player.nick;
                let score = player.score;

                // ZABEZPIECZENIE: Zamień null/undefined/NaN na 0
                if (score === null || score === undefined || isNaN(score)) {
                    logger.warn(`[PHASE1] ⚠️ Wykryto nieprawidłowy wynik dla "${nick}": ${score} - zamieniam na 0`);
                    score = 0;
                }

                if (!session.aggregatedResults.has(nick)) {
                    session.aggregatedResults.set(nick, []);
                }

                session.aggregatedResults.get(nick).push(score);
            }
        }

        logger.info(`[PHASE1] 📊 Zagregowano wyniki dla ${session.aggregatedResults.size} unikalnych nicków`);
    }

    /**
     * Identyfikuje konflikty (różne wartości dla tego samego nicka)
     */
    identifyConflicts(session) {
        session.conflicts = [];

        for (const [nick, scores] of session.aggregatedResults.entries()) {
            // Sprawdź czy jest konflikt (różne wartości)
            const uniqueScores = [...new Set(scores)];

            if (uniqueScores.length > 1) {
                // Konflikt - policz wystąpienia każdej wartości
                const valueCounts = new Map();
                for (const score of scores) {
                    valueCounts.set(score, (valueCounts.get(score) || 0) + 1);
                }

                const values = Array.from(valueCounts.entries())
                    .map(([value, count]) => ({ value, count }))
                    .sort((a, b) => b.count - a.count); // Sortuj po liczbie wystąpień

                // Zawsze wymagaj wyboru przy konflikcie - bez autoakceptacji
                session.conflicts.push({ nick, values });
            }
        }

        logger.info(`[PHASE1] ❓ Zidentyfikowano ${session.conflicts.length} konfliktów wymagających wyboru`);
        return session.conflicts;
    }

    /**
     * Rozstrzyga konflikt dla danego nicka
     */
    resolveConflict(session, nick, selectedValue) {
        session.resolvedConflicts.set(nick, selectedValue);
        logger.info(`[PHASE1] ✅ Rozstrzygnięto konflikt dla "${nick}": ${selectedValue}`);
    }

    /**
     * Pobiera następny nierozstrzygnięty konflikt
     */
    getNextUnresolvedConflict(session) {
        for (const conflict of session.conflicts) {
            if (!session.resolvedConflicts.has(conflict.nick)) {
                return conflict;
            }
        }
        return null;
    }

    /**
     * Generuje finalne wyniki (po rozstrzygnięciu konfliktów)
     */
    getFinalResults(session) {
        const finalResults = new Map();

        for (const [nick, scores] of session.aggregatedResults.entries()) {
            const uniqueScores = [...new Set(scores)];

            if (uniqueScores.length === 1) {
                // Brak konfliktu - użyj jedynej wartości
                let finalScore = uniqueScores[0];

                // ZABEZPIECZENIE: Zamień null/undefined/NaN na 0
                if (finalScore === null || finalScore === undefined || isNaN(finalScore)) {
                    logger.warn(`[PHASE1] ⚠️ Wykryto nieprawidłowy finalny wynik dla "${nick}": ${finalScore} - zamieniam na 0`);
                    finalScore = 0;
                }

                finalResults.set(nick, finalScore);
            } else {
                // Konflikt - użyj rozstrzygniętej wartości
                let resolvedValue = session.resolvedConflicts.get(nick);

                if (resolvedValue !== undefined) {
                    // ZABEZPIECZENIE: Zamień null/undefined/NaN na 0
                    if (resolvedValue === null || isNaN(resolvedValue)) {
                        logger.warn(`[PHASE1] ⚠️ Wykryto nieprawidłowy rozstrzygnięty wynik dla "${nick}": ${resolvedValue} - zamieniam na 0`);
                        resolvedValue = 0;
                    }

                    finalResults.set(nick, resolvedValue);
                } else {
                    logger.warn(`[PHASE1] ⚠️ Nierozstrzygnięty konflikt dla "${nick}", pomijam`);
                }
            }
        }

        return finalResults;
    }

    /**
     * Oblicza statystyki finalne
     */
    calculateStatistics(finalResults) {
        const uniqueNicks = finalResults.size;
        let aboveZero = 0;
        let zeroCount = 0;

        const sortedScores = Array.from(finalResults.values())
            .map(score => parseInt(score) || 0)
            .sort((a, b) => b - a);

        for (const score of sortedScores) {
            if (score > 0) {
                aboveZero++;
            } else if (score === 0) {
                zeroCount++;
            }
        }

        const top30Sum = sortedScores.slice(0, 30).reduce((sum, score) => sum + score, 0);

        return {
            uniqueNicks,
            aboveZero,
            zeroCount,
            top30Sum,
            sortedScores
        };
    }

    /**
     * Zapisuje wyniki do bazy danych
     */
    async saveFinalResults(session, finalResults, guild, createdBy) {
        const weekInfo = this.getCurrentWeekInfo();

        logger.info(`[PHASE1] 💾 Zapisywanie wyników dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}, klan: ${session.clan}`);

        // Usuń stare dane jeśli istnieją
        await this.databaseService.deletePhase1DataForWeek(session.guildId, weekInfo.weekNumber, weekInfo.year, session.clan);

        // Zapisz nowe dane
        const members = await safeFetchMembers(guild, logger);
        const savedCount = [];
        let isFirstSave = true;

        for (const [nick, score] of finalResults.entries()) {
            // Znajdź członka Discord
            const member = members.find(m =>
                m.displayName.toLowerCase() === nick.toLowerCase() ||
                m.user.username.toLowerCase() === nick.toLowerCase()
            );

            if (member) {
                await this.databaseService.savePhase1Result(
                    session.guildId,
                    member.id,
                    member.displayName,
                    parseInt(score) || 0,
                    weekInfo.weekNumber,
                    weekInfo.year,
                    session.clan,
                    isFirstSave ? createdBy : null
                );
                savedCount.push(nick);
                isFirstSave = false;
            } else {
                logger.warn(`[PHASE1] ⚠️ Nie znaleziono członka Discord dla nicka: ${nick}`);
            }
        }

        logger.info(`[PHASE1] ✅ Zapisano ${savedCount.length}/${finalResults.size} wyników`);
        return savedCount.length;
    }

    /**
     * Pobiera informacje o bieżącym tygodniu (ISO week)
     * MODYFIKACJA: Tydzień zaczyna się we wtorek zamiast w poniedziałek
     */
    getCurrentWeekInfo() {
        const now = new Date();

        // Jeśli jest poniedziałek, użyj numeru tygodnia z poprzedniej niedzieli
        const dayOfWeek = now.getDay();
        const dateForWeek = dayOfWeek === 1 ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now;

        // Oblicz czwartek tego tygodnia (standard ISO 8601)
        // Tydzień należy do roku, w którym wypada jego czwartek
        const target = new Date(dateForWeek.valueOf());
        const dayNumber = (dateForWeek.getDay() + 6) % 7; // poniedziałek = 0
        target.setDate(target.getDate() - dayNumber + 3); // +3 = czwartek

        // Rok ISO tygodnia to rok czwartku
        const year = target.getFullYear();
        const weekNumber = this.getISOWeek(dateForWeek);

        return { weekNumber, year };
    }

    /**
     * Oblicza numer tygodnia ISO
     */
    getISOWeek(date) {
        const target = new Date(date.valueOf());
        const dayNumber = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNumber + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

    /**
     * Tworzy embed z prośbą o zdjęcia
     */
    createAwaitingImagesEmbed(phase = 1, round = null) {
        const expiryTime = Date.now() + (15 * 60 * 1000); // 15 minut od teraz
        const expiryTimestamp = Math.floor(expiryTime / 1000);

        // Pobierz informacje o aktualnym tygodniu
        const { weekNumber, year } = this.getCurrentWeekInfo();

        let title = `📸 Faza ${phase} - Prześlij zdjęcia wyników`;
        if (phase === 2 && round) {
            title = `📸 Faza 2 - Runda ${round}/3 - Prześlij zdjęcia wyników`;
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(
                `📅 **Tydzień:** ${weekNumber}/${year}\n\n` +
                '**⚠️ WAŻNE - Zasady robienia screenów:**\n' +
                '**1.** Rób screeny starannie, nicki nie mogą być ucięte w połowie\n' +
                '**2.** Im więcej screenów, tym lepsza jakość odczytu\n' +
                '   • TYLKO pierwszy i ostatni nick nie może się powtórzyć!\n' +
                '   • Wszystkie inne nicki muszą być powtórzone!\n' +
                '   • Rób screeny zgodnie z zasadą 1-9, +4, +5, +4, +5... 31-39, 32-40.\n' +
                '**3.** Sprawdź dokładnie czy ostateczny wynik odczytu zgadza się z rzeczywistą ilością zdobytych punktów w grze.\n' +
                '**Zaakceptuj wynik tylko wtedy, gdy wszystko się zgadza!**\n\n' +
                '**Możesz przesłać od 1 do 10 zdjęć w jednej wiadomości.**'
            )
            .setColor('#0099FF')
            .setTimestamp()
            .setFooter({ text: 'Prześlij zdjęcia zwykłą wiadomością na tym kanale' });

        const customIdPrefix = phase === 2 ? 'phase2' : 'phase1';
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${customIdPrefix}_cancel_session`)
                    .setLabel('❌ Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        return { embed, row };
    }

    /**
     * Tworzy embed z potwierdzeniem przetworzonych zdjęć
     */
    createProcessedImagesEmbed(session) {
        // Oblicz statystyki (tak samo jak w updateProgress)
        const uniqueNicks = session.aggregatedResults.size;
        const confirmedResults = Array.from(session.aggregatedResults.values())
            .filter(scores => scores.length >= 2 && new Set(scores).size === 1).length;
        const unconfirmedResults = uniqueNicks - confirmedResults;

        // Oblicz konflikty
        const conflictsCount = Array.from(session.aggregatedResults.values())
            .filter(scores => new Set(scores).size > 1).length;

        // Oblicz graczy z zerem - TYLKO gdy wszystkie wartości to 0 (brak konfliktu)
        const playersWithZero = Array.from(session.aggregatedResults.entries())
            .filter(([nick, scores]) => {
                const uniqueScores = [...new Set(scores)];
                // Zlicz tylko gdy NIE MA konfliktu i wszystkie wartości to 0
                return uniqueScores.length === 1 && (uniqueScores[0] === 0 || uniqueScores[0] === '0');
            })
            .length;

        const totalImages = session.processedImages.length;
        const progressBar = this.createProgressBar(totalImages, totalImages, 'completed', true);

        const phaseTitle = session.phase === 2 ? 'Faza 2' : 'Faza 1';
        const roundText = session.phase === 2 ? ` - Runda ${session.currentRound}/3` : '';

        const embed = new EmbedBuilder()
            .setTitle(`✅ Analiza zakończona - ${phaseTitle}${roundText}`)
            .setDescription(`${progressBar}\n\n📸 Przeanalizowano **${totalImages}/${totalImages}** zdjęć`)
            .setColor('#00FF00')
            .addFields(
                { name: '👥 Unikalnych nicków', value: uniqueNicks.toString(), inline: true },
                { name: '✅ Potwierdzone', value: confirmedResults.toString(), inline: true },
                { name: '❓ Niepotwierdzone', value: unconfirmedResults.toString(), inline: true },
                { name: '⚠️ Konflikty', value: conflictsCount.toString(), inline: true },
                { name: '🥚 Graczy z zerem', value: playersWithZero.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Czy chcesz analizować wyniki czy dodać więcej zdjęć?' });

        const phasePrefix = session.phase === 2 ? 'phase2' : 'phase1';

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_complete_yes`)
                    .setLabel('✅ Tak, analizuj')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_complete_no`)
                    .setLabel('➕ Dodaj więcej')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_cancel_session`)
                    .setLabel('❌ Anuluj sesję')
                    .setStyle(ButtonStyle.Danger)
            );

        return { embed, row };
    }

    /**
     * Tworzy embed z konfliktem
     */
    createConflictEmbed(conflict, currentIndex, totalConflicts, phase = 1) {
        const valuesText = conflict.values
            .map(v => `• **${v.value}** (${v.count}x)`)
            .join('\n');

        const embed = new EmbedBuilder()
            .setTitle(`❓ Konflikt ${currentIndex}/${totalConflicts}`)
            .setDescription(`**Nick:** ${conflict.nick}\n\n**Odczytane wartości:**\n${valuesText}\n\nKtóra wartość jest prawidłowa?`)
            .setColor('#FFA500')
            .setTimestamp()
            .setFooter({ text: `Rozstrzyganie konfliktów • ${currentIndex} z ${totalConflicts}` });

        const row = new ActionRowBuilder();
        const phasePrefix = phase === 2 ? 'phase2' : 'phase1';

        // Dodaj przyciski dla każdej wartości (max 4, bo 5. miejsce dla "Wpisz ręcznie")
        // CustomId format: phase1_resolve_{nick}_{value}
        for (let i = 0; i < Math.min(conflict.values.length, 4); i++) {
            const value = conflict.values[i];
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_resolve_${conflict.nick}_${value.value}`)
                    .setLabel(`${value.value}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        // Dodaj przycisk "Wpisz ręcznie" w kolorze czerwonym
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`${phasePrefix}_manual_${conflict.nick}`)
                .setLabel('Wpisz ręcznie')
                .setStyle(ButtonStyle.Danger)
        );

        return { embed, row };
    }

    /**
     * Tworzy embed z finalnym podsumowaniem
     */
    createFinalSummaryEmbed(stats, weekInfo, clan, phase = 1) {
        const clanName = this.config.roleDisplayNames[clan] || clan;
        const phaseTitle = phase === 2 ? 'Faza 2' : 'Faza 1';
        const phasePrefix = phase === 2 ? 'phase2' : 'phase1';

        const fields = [];

        // Dla Fazy 1 - pokaż wszystkie statystyki
        if (phase === 1) {
            fields.push(
                { name: '✅ Unikalnych nicków', value: stats.uniqueNicks.toString(), inline: true },
                { name: '📈 Wynik powyżej 0', value: `${stats.aboveZero} osób`, inline: true },
                { name: '⭕ Wynik równy 0', value: `${stats.zeroCount} osób`, inline: true },
                { name: '🏆 Suma wyników TOP30', value: `${stats.top30Sum.toLocaleString('pl-PL')} punktów`, inline: false }
            );
        } else if (phase === 2) {
            // Dla Fazy 2 - pokaż sumę TOP30 i sumę zer z 3 rund
            fields.push(
                { name: '🏆 Suma TOP30 (z 3 rund)', value: `${stats.top30Sum.toLocaleString('pl-PL')} punktów`, inline: false }
            );

            if (stats.totalZeroCount !== undefined) {
                fields.push(
                    { name: '⭕ Wynik = 0 (suma z 3 rund)', value: `${stats.totalZeroCount} wystąpień`, inline: false }
                );
            }
        }

        // Dla obu faz dodaj klan
        fields.push({ name: '🎯 Analizowany klan', value: clanName, inline: false });

        const embed = new EmbedBuilder()
            .setTitle(`📊 Podsumowanie ${phaseTitle} - Tydzień ${weekInfo.weekNumber}/${weekInfo.year}`)
            .setDescription('Przeanalizowano wszystkie zdjęcia i rozstrzygnięto konflikty.\n\n**⚠️ Sprawdź dokładnie czy ostateczny wynik odczytu zgadza się z rzeczywistą ilością zdobytych punktów w grze.**\n**Zaakceptuj wynik tylko wtedy, gdy wszystko się zgadza!**')
            .setColor('#00FF00')
            .addFields(...fields)
            .setTimestamp()
            .setFooter({ text: 'Czy zatwierdzić i zapisać dane?' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_confirm_save`)
                    .setLabel('🟢 Zatwierdź')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_cancel_save`)
                    .setLabel('🔴 Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        return { embed, row };
    }

    /**
     * Tworzy embed z ostrzeżeniem o istniejących danych
     */
    async createOverwriteWarningEmbed(guildId, weekInfo, clan, phase = 1, guild = null) {
        let existingData;

        if (phase === 2) {
            existingData = await this.databaseService.getPhase2Summary(guildId, weekInfo.weekNumber, weekInfo.year, clan);
        } else {
            existingData = await this.databaseService.getPhase1Summary(guildId, weekInfo.weekNumber, weekInfo.year, clan);
        }

        if (!existingData) {
            return null;
        }

        const createdDate = new Date(existingData.createdAt);
        const dateStr = createdDate.toLocaleString('pl-PL');

        const clanName = this.config.roleDisplayNames[clan] || clan;

        const fields = [
            { name: '📅 Data zapisu', value: dateStr, inline: true }
        ];

        // Dodaj informacje o twórcy jeśli dostępne
        logger.info(`[PHASE${phase}] createdBy: ${existingData.createdBy}, guild: ${guild ? 'exists' : 'null'}`);

        if (existingData.createdBy && guild) {
            try {
                const creator = await guild.members.fetch(existingData.createdBy);
                fields.push({ name: '👤 Dodane przez', value: creator.displayName, inline: true });
                logger.info(`[PHASE${phase}] Dodano pole 'Dodane przez': ${creator.displayName}`);
            } catch (error) {
                logger.warn(`[PHASE${phase}] Nie znaleziono użytkownika ${existingData.createdBy}:`, error.message);
            }
        } else {
            logger.warn(`[PHASE${phase}] Brak informacji o twórcy - createdBy: ${existingData.createdBy}, guild: ${guild ? 'exists' : 'null'}`);
        }

        // Dodaj liczbę graczy tylko dla Fazy 1
        if (phase === 1) {
            fields.push({ name: '👥 Liczba graczy', value: existingData.playerCount.toString(), inline: true });
        }

        // Dodaj sumę TOP30 tylko dla Fazy 1
        if (phase === 1) {
            fields.push({ name: '🏆 Suma TOP30', value: `${existingData.top30Sum.toLocaleString('pl-PL')} pkt`, inline: true });
        }

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Dane już istnieją')
            .setDescription(`Dane Fazy ${phase} dla tygodnia **${weekInfo.weekNumber}/${weekInfo.year}** (klan: **${clanName}**) już istnieją w bazie.`)
            .setColor('#FF6600')
            .addFields(...fields)
            .setTimestamp()
            .setFooter({ text: 'Czy chcesz nadpisać te dane?' });

        const customIdPrefix = phase === 2 ? 'phase2' : 'phase1';
        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${customIdPrefix}_overwrite_yes`)
                    .setLabel('🔴 Nadpisz stare dane')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId(`${customIdPrefix}_overwrite_no`)
                    .setLabel('⚪ Anuluj')
                    .setStyle(ButtonStyle.Secondary)
            );

        return { embed, row };
    }

    /**
     * Przechodzi do następnej rundy dla Fazy 2
     */
    startNextRound(session) {
        // Zapisz dane z aktualnej rundy
        const finalResults = this.getFinalResults(session);
        logger.info(`[PHASE2] 📊 Wyniki rundy ${session.currentRound}: ${finalResults.size} graczy`);

        const roundData = {
            round: session.currentRound,
            results: finalResults
        };
        session.roundsData.push(roundData);

        logger.info(`[PHASE2] ✅ Zakończono rundę ${session.currentRound}/3`);

        // Wyczyść dane do następnej rundy
        session.processedImages = [];
        session.aggregatedResults = new Map();
        session.conflicts = [];
        session.resolvedConflicts = new Map();
        session.downloadedFiles = [];
        session.currentRound++;
        session.stage = 'awaiting_images';

        logger.info(`[PHASE2] 🔄 Rozpoczynam rundę ${session.currentRound}/3`);
    }

    /**
     * Sumuje wyniki ze wszystkich rund dla Fazy 2
     */
    sumPhase2Results(session) {
        const summedResults = new Map(); // nick → total score

        logger.info(`[PHASE2] 🔢 Sumowanie wyników z ${session.roundsData.length} rund`);

        // Sumuj wyniki ze wszystkich rund
        for (const roundData of session.roundsData) {
            if (!roundData.results) {
                logger.error(`[PHASE2] ❌ Brak wyników dla rundy ${roundData.round}`);
                continue;
            }

            if (!(roundData.results instanceof Map)) {
                logger.error(`[PHASE2] ❌ Wyniki rundy ${roundData.round} nie są Mapą:`, typeof roundData.results);
                continue;
            }

            logger.info(`[PHASE2] Runda ${roundData.round}: ${roundData.results.size} graczy`);

            for (const [nick, score] of roundData.results) {
                if (score === null || score === undefined || isNaN(score)) {
                    logger.warn(`[PHASE2] ⚠️ Nieprawidłowy wynik dla ${nick} w rundzie ${roundData.round}: ${score}`);
                    continue;
                }
                const currentScore = summedResults.get(nick) || 0;
                summedResults.set(nick, currentScore + score);
            }
        }

        logger.info(`[PHASE2] ✅ Suma wyników: ${summedResults.size} graczy`);
        return summedResults;
    }
}

module.exports = PhaseService;
