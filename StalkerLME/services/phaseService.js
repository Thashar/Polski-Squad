const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');

const logger = createBotLogger('StalkerLME');

class PhaseService {
    constructor(config, databaseService, ocrService) {
        this.config = config;
        this.databaseService = databaseService;
        this.ocrService = ocrService;
        this.activeSessions = new Map(); // sessionId → session data
        this.tempDir = path.join(__dirname, '..', 'temp', 'phase1');
        this.activeProcessing = new Map(); // guildId → userId (kto obecnie przetwarza)
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
     * Usuwa aktywne przetwarzanie
     */
    clearActiveProcessing(guildId) {
        this.activeProcessing.delete(guildId);
        logger.info(`[PHASE1] 🔓 Odblokowano przetwarzanie dla guild ${guildId}`);
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
    createSession(userId, guildId, channelId, phase = 1) {
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
            publicInteraction: null // interakcja do aktualizacji postępu (PUBLICZNA)
        };

        this.activeSessions.set(sessionId, session);

        // Auto-cleanup po 15 minutach
        session.timeout = setTimeout(() => {
            this.cleanupSession(sessionId);
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

        session.timeout = setTimeout(() => {
            this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);
    }

    /**
     * Usuwa sesję
     */
    async cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        if (session.timeout) {
            clearTimeout(session.timeout);
        }

        // Usuń pliki z temp
        await this.cleanupSessionFiles(sessionId);

        // Wyczyść duże struktury danych z pamięci
        if (session.processedImages) {
            session.processedImages = [];
        }
        if (session.aggregatedResults) {
            session.aggregatedResults.clear();
        }
        if (session.conflicts) {
            session.conflicts = [];
        }
        if (session.resolvedConflicts) {
            session.resolvedConflicts.clear();
        }
        if (session.roundsData) {
            session.roundsData = [];
        }
        if (session.downloadedFiles) {
            session.downloadedFiles = [];
        }

        // Odblokuj przetwarzanie dla tego guild
        this.clearActiveProcessing(session.guildId);

        this.activeSessions.delete(sessionId);

        // Wymuś garbage collection jeśli dostępne (tylko w trybie --expose-gc)
        if (global.gc) {
            global.gc();
            logger.info(`[PHASE${session.phase || 1}] 🗑️ Usunięto sesję i wywołano garbage collection: ${sessionId}`);
        } else {
            logger.info(`[PHASE${session.phase || 1}] 🗑️ Usunięto sesję: ${sessionId}`);
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

        session.publicInteraction = publicInteraction;

        logger.info(`[PHASE1] 🔄 Przetwarzanie ${downloadedFiles.length} zdjęć z dysku dla sesji ${sessionId}`);

        const results = [];
        const totalImages = downloadedFiles.length;

        for (let i = 0; i < downloadedFiles.length; i++) {
            const fileData = downloadedFiles[i];
            const attachment = fileData.originalAttachment;

            try {
                // Aktualizuj postęp - ładowanie
                await this.updateProgress(session, {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'loading',
                    action: 'Ładowanie zdjęcia'
                });

                logger.info(`[PHASE1] 📷 Przetwarzanie zdjęcia ${i + 1}/${totalImages}: ${attachment.name}`);

                // Aktualizuj postęp - OCR
                await this.updateProgress(session, {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'ocr',
                    action: 'Rozpoznawanie tekstu (OCR)'
                });

                // Przetwórz OCR z pliku lokalnego
                const text = await this.ocrService.processImageFromFile(fileData.filepath);

                // Aktualizuj postęp - ekstrakcja
                await this.updateProgress(session, {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'extracting',
                    action: 'Wyciąganie wyników graczy'
                });

                // Wyciągnij wszystkich graczy z wynikami (nie tylko zerami)
                const playersWithScores = await this.ocrService.extractAllPlayersWithScores(text, guild, member);

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

                // Aktualizuj postęp - agregacja
                await this.updateProgress(session, {
                    currentImage: i + 1,
                    totalImages: totalImages,
                    stage: 'aggregating',
                    action: 'Agregacja wyników'
                });

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
                .filter(scores => new Set(scores).size === 1).length;
            const unconfirmedResults = uniqueNicks - confirmedResults;

            const progressBar = this.createProgressBar(percent);

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
                .setDescription(`**Zdjęcie:** ${currentImage}/${totalImages}\n${icon} ${action}\n${progressBar} ${percent}%`)
                .setColor('#FFA500')
                .addFields(
                    { name: '👥 Unikalnych nicków', value: uniqueNicks.toString(), inline: true },
                    { name: '✅ Potwierdzonych wyników', value: confirmedResults.toString(), inline: true },
                    { name: '❓ Niepotwierdzonych', value: unconfirmedResults.toString(), inline: true }
                )
                .setTimestamp()
                .setFooter({ text: 'Przetwarzanie...' });

            await session.publicInteraction.editReply({
                embeds: [embed]
            });
        } catch (error) {
            logger.error('[PHASE1] ❌ Błąd aktualizacji postępu:', error);
        }
    }

    /**
     * Tworzy pasek postępu
     */
    createProgressBar(percent) {
        const filled = Math.round(percent / 5);
        const empty = 20 - filled;
        return '█'.repeat(filled) + '░'.repeat(empty);
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
                const score = player.score;

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

                session.conflicts.push({ nick, values });
            }
        }

        logger.info(`[PHASE1] ❓ Zidentyfikowano ${session.conflicts.length} konfliktów`);
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
                finalResults.set(nick, uniqueScores[0]);
            } else {
                // Konflikt - użyj rozstrzygniętej wartości
                const resolvedValue = session.resolvedConflicts.get(nick);
                if (resolvedValue !== undefined) {
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
    async saveFinalResults(session, finalResults, guild) {
        const weekInfo = this.getCurrentWeekInfo();

        logger.info(`[PHASE1] 💾 Zapisywanie wyników dla tygodnia ${weekInfo.weekNumber}/${weekInfo.year}`);

        // Usuń stare dane jeśli istnieją
        await this.databaseService.deletePhase1DataForWeek(session.guildId, weekInfo.weekNumber, weekInfo.year);

        // Zapisz nowe dane
        const members = await guild.members.fetch();
        const savedCount = [];

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
                    session.clan
                );
                savedCount.push(nick);
            } else {
                logger.warn(`[PHASE1] ⚠️ Nie znaleziono członka Discord dla nicka: ${nick}`);
            }
        }

        logger.info(`[PHASE1] ✅ Zapisano ${savedCount.length}/${finalResults.size} wyników`);
        return savedCount.length;
    }

    /**
     * Pobiera informacje o bieżącym tygodniu (ISO week)
     */
    getCurrentWeekInfo() {
        const now = new Date();
        const year = now.getFullYear();
        const weekNumber = this.getISOWeek(now);

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
        const expiryTime = Date.now() + (5 * 60 * 1000); // 5 minut od teraz
        const expiryTimestamp = Math.floor(expiryTime / 1000);

        let title = `📸 Faza ${phase} - Prześlij zdjęcia wyników`;
        if (phase === 2 && round) {
            title = `📸 Faza 2 - Runda ${round}/3 - Prześlij zdjęcia wyników`;
        }

        return new EmbedBuilder()
            .setTitle(title)
            .setDescription(
                '**⚠️ WAŻNE - Zasady robienia screenów:**\n' +
                '• Rób screeny **prosto i starannie**\n' +
                '• Im więcej screenów (do 10), tym lepsza jakość odczytu\n' +
                '• Jeśli nick pojawi się **przynajmniej 2x**, zwiększa to pewność danych\n' +
                '• Unikaj rozmazanych lub przekrzywionych zdjęć\n\n' +
                '**Możesz przesłać od 1 do 10 zdjęć w jednej wiadomości.**\n\n' +
                `⏱️ Czas wygaśnięcia: <t:${expiryTimestamp}:R>`
            )
            .setColor('#0099FF')
            .setTimestamp()
            .setFooter({ text: 'Prześlij zdjęcia zwykłą wiadomością na tym kanale' });
    }

    /**
     * Tworzy embed z potwierdzeniem przetworzonych zdjęć
     */
    createProcessedImagesEmbed(processedCount, totalImages, phase = 1) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Zdjęcia przetworzone')
            .setDescription(`Przetworzono **${processedCount}** zdjęć.\nŁącznie w sesji: **${totalImages}** zdjęć.`)
            .setColor('#00FF00')
            .setTimestamp();

        const phasePrefix = phase === 2 ? 'phase2' : 'phase1';

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_complete_yes`)
                    .setLabel('✅ Tak, analizuj')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_complete_no`)
                    .setLabel('➕ Dodaj więcej')
                    .setStyle(ButtonStyle.Primary)
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

        // Dodaj przyciski dla każdej wartości (max 5)
        for (let i = 0; i < Math.min(conflict.values.length, 5); i++) {
            const value = conflict.values[i];
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`${phasePrefix}_resolve_${value.value}`)
                    .setLabel(`${value.value}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        return { embed, row };
    }

    /**
     * Tworzy embed z finalnym podsumowaniem
     */
    createFinalSummaryEmbed(stats, weekInfo, clan, phase = 1) {
        const clanName = this.config.roleDisplayNames[clan] || clan;
        const phaseTitle = phase === 2 ? 'Faza 2' : 'Faza 1';
        const phasePrefix = phase === 2 ? 'phase2' : 'phase1';

        const fields = [
            { name: '✅ Unikalnych nicków', value: stats.uniqueNicks.toString(), inline: true },
            { name: '📈 Wynik powyżej 0', value: `${stats.aboveZero} osób`, inline: true },
            { name: '⭕ Wynik równy 0', value: `${stats.zeroCount} osób`, inline: true }
        ];

        // Dodaj sumę top 30 tylko dla Fazy 1
        if (phase === 1) {
            fields.push({ name: '🏆 Suma wyników top 30', value: `${stats.top30Sum.toLocaleString('pl-PL')} punktów`, inline: false });
        }

        fields.push({ name: '🎯 Klan', value: clanName, inline: false });

        const embed = new EmbedBuilder()
            .setTitle(`📊 Podsumowanie ${phaseTitle} - Tydzień ${weekInfo.weekNumber}/${weekInfo.year}`)
            .setDescription('Przeanalizowano wszystkie zdjęcia i rozstrzygnięto konflikty.')
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
    async createOverwriteWarningEmbed(guildId, weekInfo, clan, phase = 1) {
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
            { name: '📅 Data zapisu', value: dateStr, inline: true },
            { name: '👥 Liczba graczy', value: existingData.playerCount.toString(), inline: true }
        ];

        // Dodaj sumę TOP30 tylko dla Fazy 1
        if (phase === 1) {
            fields.push({ name: '🏆 Suma top 30', value: `${existingData.top30Sum.toLocaleString('pl-PL')} pkt`, inline: true });
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
        const roundData = {
            round: session.currentRound,
            results: this.getFinalResults(session)
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

        // Sumuj wyniki ze wszystkich rund
        for (const roundData of session.roundsData) {
            for (const [nick, score] of roundData.results) {
                const currentScore = summedResults.get(nick) || 0;
                summedResults.set(nick, currentScore + score);
            }
        }

        return summedResults;
    }
}

module.exports = PhaseService;
