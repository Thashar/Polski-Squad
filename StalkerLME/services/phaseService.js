const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

class PhaseService {
    constructor(config, databaseService, ocrService) {
        this.config = config;
        this.databaseService = databaseService;
        this.ocrService = ocrService;
        this.activeSessions = new Map(); // sessionId → session data
    }

    /**
     * Tworzy nową sesję Fazy 1
     */
    createSession(userId, guildId, channelId) {
        const sessionId = `${userId}_${Date.now()}`;

        const session = {
            sessionId,
            userId,
            guildId,
            channelId,
            processedImages: [], // [{imageUrl, results: [{nick, score}]}]
            aggregatedResults: new Map(), // nick → [scores]
            conflicts: [], // [{nick, values: [{value, count}]}]
            resolvedConflicts: new Map(), // nick → finalScore
            stage: 'awaiting_images', // 'awaiting_images' | 'confirming_complete' | 'resolving_conflicts' | 'final_confirmation'
            createdAt: Date.now(),
            timeout: null
        };

        this.activeSessions.set(sessionId, session);

        // Auto-cleanup po 15 minutach
        session.timeout = setTimeout(() => {
            this.cleanupSession(sessionId);
        }, 15 * 60 * 1000);

        logger.info(`[PHASE1] 📝 Utworzono sesję: ${sessionId}`);
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
    cleanupSession(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        if (session.timeout) {
            clearTimeout(session.timeout);
        }

        this.activeSessions.delete(sessionId);
        logger.info(`[PHASE1] 🗑️ Usunięto sesję: ${sessionId}`);
    }

    /**
     * Przetwarza zdjęcia i dodaje wyniki do sesji
     */
    async processImages(sessionId, attachments, guild, member) {
        const session = this.getSession(sessionId);
        if (!session) {
            throw new Error('Sesja nie istnieje lub wygasła');
        }

        logger.info(`[PHASE1] 📸 Przetwarzanie ${attachments.length} zdjęć dla sesji ${sessionId}`);

        const results = [];

        for (let i = 0; i < attachments.length; i++) {
            const attachment = attachments[i];

            try {
                logger.info(`[PHASE1] 📷 Przetwarzanie zdjęcia ${i + 1}/${attachments.length}: ${attachment.url}`);

                // Przetwórz OCR
                const text = await this.ocrService.processImage(attachment);

                // Wyciągnij wszystkich graczy z wynikami (nie tylko zerami)
                const playersWithScores = await this.ocrService.extractAllPlayersWithScores(text, guild, member);

                results.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    results: playersWithScores
                });

                logger.info(`[PHASE1] ✅ Znaleziono ${playersWithScores.length} graczy na zdjęciu ${i + 1}`);
            } catch (error) {
                logger.error(`[PHASE1] ❌ Błąd przetwarzania zdjęcia ${i + 1}:`, error);
                results.push({
                    imageUrl: attachment.url,
                    imageName: attachment.name,
                    error: error.message,
                    results: []
                });
            }
        }

        // Dodaj wyniki do sesji
        session.processedImages.push(...results);

        // Agreguj wyniki
        this.aggregateResults(session);

        return results;
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
                    weekInfo.year
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
    createAwaitingImagesEmbed() {
        return new EmbedBuilder()
            .setTitle('📸 Faza 1 - Prześlij zdjęcia wyników')
            .setDescription('Możesz przesłać od **1 do 10 zdjęć** w jednej wiadomości.\n\n⏱️ Czekam **5 minut** na zdjęcia...')
            .setColor('#0099FF')
            .setTimestamp()
            .setFooter({ text: 'Prześlij zdjęcia zwykłą wiadomością na tym kanale' });
    }

    /**
     * Tworzy embed z potwierdzeniem przetworzonych zdjęć
     */
    createProcessedImagesEmbed(processedCount, totalImages) {
        const embed = new EmbedBuilder()
            .setTitle('✅ Zdjęcia przetworzone')
            .setDescription(`Przetworzono **${processedCount}** zdjęć.\nŁącznie w sesji: **${totalImages}** zdjęć.`)
            .setColor('#00FF00')
            .setTimestamp();

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('phase1_complete_yes')
                    .setLabel('✅ Tak, analizuj')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('phase1_complete_no')
                    .setLabel('➕ Dodaj więcej')
                    .setStyle(ButtonStyle.Primary)
            );

        return { embed, row };
    }

    /**
     * Tworzy embed z konfliktem
     */
    createConflictEmbed(conflict, currentIndex, totalConflicts) {
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

        // Dodaj przyciski dla każdej wartości (max 5)
        for (let i = 0; i < Math.min(conflict.values.length, 5); i++) {
            const value = conflict.values[i];
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`phase1_resolve_${conflict.nick}_${value.value}`)
                    .setLabel(`${value.value}`)
                    .setStyle(ButtonStyle.Secondary)
            );
        }

        return { embed, row };
    }

    /**
     * Tworzy embed z finalnym podsumowaniem
     */
    createFinalSummaryEmbed(stats, weekInfo) {
        const embed = new EmbedBuilder()
            .setTitle(`📊 Podsumowanie Faza 1 - Tydzień ${weekInfo.weekNumber}/${weekInfo.year}`)
            .setDescription('Przeanalizowano wszystkie zdjęcia i rozstrzygnięto konflikty.')
            .setColor('#00FF00')
            .addFields(
                { name: '✅ Unikalnych nicków', value: stats.uniqueNicks.toString(), inline: true },
                { name: '📈 Wynik powyżej 0', value: `${stats.aboveZero} osób`, inline: true },
                { name: '⭕ Wynik równy 0', value: `${stats.zeroCount} osób`, inline: true },
                { name: '🏆 Suma wyników top 30', value: `${stats.top30Sum.toLocaleString('pl-PL')} punktów`, inline: false }
            )
            .setTimestamp()
            .setFooter({ text: 'Czy zatwierdzić i zapisać dane?' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('phase1_confirm_save')
                    .setLabel('🟢 Zatwierdź')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('phase1_cancel_save')
                    .setLabel('🔴 Anuluj')
                    .setStyle(ButtonStyle.Danger)
            );

        return { embed, row };
    }

    /**
     * Tworzy embed z ostrzeżeniem o istniejących danych
     */
    async createOverwriteWarningEmbed(guildId, weekInfo) {
        const existingData = await this.databaseService.getPhase1Summary(guildId, weekInfo.weekNumber, weekInfo.year);

        if (!existingData) {
            return null;
        }

        const createdDate = new Date(existingData.createdAt);
        const dateStr = createdDate.toLocaleString('pl-PL');

        const embed = new EmbedBuilder()
            .setTitle('⚠️ Dane już istnieją')
            .setDescription(`Dane dla tygodnia **${weekInfo.weekNumber}/${weekInfo.year}** już istnieją w bazie.`)
            .setColor('#FF6600')
            .addFields(
                { name: '📅 Data zapisu', value: dateStr, inline: true },
                { name: '👥 Liczba graczy', value: existingData.playerCount.toString(), inline: true },
                { name: '🏆 Suma top 30', value: `${existingData.top30Sum.toLocaleString('pl-PL')} pkt`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: 'Czy chcesz nadpisać te dane?' });

        const row = new ActionRowBuilder()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId('phase1_overwrite_yes')
                    .setLabel('🔴 Nadpisz stare dane')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setCustomId('phase1_overwrite_no')
                    .setLabel('⚪ Anuluj')
                    .setStyle(ButtonStyle.Secondary)
            );

        return { embed, row };
    }
}

module.exports = PhaseService;
