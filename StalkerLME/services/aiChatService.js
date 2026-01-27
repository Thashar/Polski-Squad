const fs = require('fs').promises;
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('StalkerLME');

/**
 * AI Chat Service - Obsługa rozmów z użytkownikami przez Anthropic API
 * Wspiera mention @StalkerLME z kontekstem danych gracza/klanu
 */
class AIChatService {
    constructor(config, databaseService, reminderUsageService = null, punishmentService = null, helperFunctions = null) {
        this.config = config;
        this.databaseService = databaseService;
        this.reminderUsageService = reminderUsageService;
        this.punishmentService = punishmentService;
        this.helperFunctions = helperFunctions || {}; // { generatePlayerProgressTextData, generatePlayerStatusTextData }

        // Anthropic API
        this.apiKey = process.env.ANTHROPIC_API_KEY;
        this.enabled = !!this.apiKey;

        if (this.enabled) {
            this.client = new Anthropic({ apiKey: this.apiKey });
            this.model = process.env.STALKER_LME_AI_CHAT_MODEL || 'claude-3-haiku-20240307';
            logger.success('✅ AI Chat aktywny - model: ' + this.model);
        } else {
            logger.warn('⚠️ AI Chat wyłączony - brak ANTHROPIC_API_KEY');
        }

        // Limity
        this.cooldownMinutes = 5; // 5 minut

        // Persistent storage
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'ai_chat_cooldowns.json');

        // In-memory cache
        this.cooldowns = new Map(); // userId -> timestamp

        // Historia konwersacji (pamięć kontekstu)
        this.conversationHistory = new Map(); // odlinkowany: userId -> {lastActivity: timestamp, messages: [{role, content}]}
        this.conversationTimeoutMs = 60 * 60 * 1000; // 1 godzina
        this.maxHistoryMessages = 10; // Max 5 par pytanie/odpowiedź

        // Load data
        this.loadData();
    }

    /**
     * Wczytaj dane z plików
     */
    async loadData() {
        try {
            // Cooldowns
            try {
                const cooldownData = await fs.readFile(this.cooldownsFile, 'utf8');
                const parsed = JSON.parse(cooldownData);
                this.cooldowns = new Map(Object.entries(parsed));
            } catch (err) {
                // Plik nie istnieje - OK
                this.cooldowns = new Map();
            }

            // Cleanup starych danych (starsze niż 2 dni)
            this.cleanupOldData();
        } catch (error) {
            logger.error(`Błąd wczytywania danych AI Chat: ${error.message}`);
        }
    }

    /**
     * Zapisz dane do plików
     */
    async saveData() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });

            // Cooldowns
            const cooldownObj = Object.fromEntries(this.cooldowns);
            await fs.writeFile(this.cooldownsFile, JSON.stringify(cooldownObj, null, 2));
        } catch (error) {
            logger.error(`Błąd zapisywania danych AI Chat: ${error.message}`);
        }
    }

    /**
     * Cleanup starych danych
     */
    cleanupOldData() {
        const now = Date.now();
        const twoDaysAgo = now - (2 * 24 * 60 * 60 * 1000);

        // Usuń stare cooldowny
        for (const [userId, timestamp] of this.cooldowns.entries()) {
            if (timestamp < twoDaysAgo) {
                this.cooldowns.delete(userId);
            }
        }
    }

    /**
     * Wczytaj potwierdzenia z pliku JSON
     */
    async loadConfirmations() {
        try {
            const data = await fs.readFile(this.config.database.reminderConfirmations, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            // Jeśli plik nie istnieje lub jest pusty, zwróć pustą strukturę
            return { sessions: {}, userStats: {} };
        }
    }

    /**
     * Pobierz historię konwersacji dla użytkownika (jeśli aktywna w ciągu ostatniej godziny)
     */
    getConversationHistory(userId) {
        const conversation = this.conversationHistory.get(userId);

        if (!conversation) {
            return [];
        }

        // Sprawdź czy konwersacja nie wygasła (1 godzina)
        const now = Date.now();
        if (now - conversation.lastActivity > this.conversationTimeoutMs) {
            this.conversationHistory.delete(userId);
            return [];
        }

        return conversation.messages;
    }

    /**
     * Dodaj wymianę pytanie/odpowiedź do historii konwersacji
     */
    addToConversationHistory(userId, userQuestion, assistantResponse) {
        const now = Date.now();
        let conversation = this.conversationHistory.get(userId);

        if (!conversation || (now - conversation.lastActivity > this.conversationTimeoutMs)) {
            // Nowa konwersacja lub wygasła - zacznij od nowa
            conversation = {
                lastActivity: now,
                messages: []
            };
        }

        // Dodaj nową wymianę
        conversation.messages.push(
            { role: 'user', content: userQuestion },
            { role: 'assistant', content: assistantResponse }
        );

        // Ogranicz historię do max wiadomości (zachowaj ostatnie)
        if (conversation.messages.length > this.maxHistoryMessages) {
            conversation.messages = conversation.messages.slice(-this.maxHistoryMessages);
        }

        // Aktualizuj timestamp
        conversation.lastActivity = now;

        // Zapisz
        this.conversationHistory.set(userId, conversation);

        // Cleanup starych konwersacji (co jakiś czas)
        this.cleanupConversationHistory();
    }

    /**
     * Wyczyść wygasłe konwersacje z pamięci
     */
    cleanupConversationHistory() {
        const now = Date.now();
        for (const [userId, conversation] of this.conversationHistory.entries()) {
            if (now - conversation.lastActivity > this.conversationTimeoutMs) {
                this.conversationHistory.delete(userId);
            }
        }
    }

    /**
     * Sprawdź czy użytkownik ma aktywną konwersację
     */
    hasActiveConversation(userId) {
        const conversation = this.conversationHistory.get(userId);
        if (!conversation) return false;

        const now = Date.now();
        return (now - conversation.lastActivity) <= this.conversationTimeoutMs;
    }

    /**
     * Sprawdź czy użytkownik jest administratorem/moderatorem
     */
    isAdmin(member) {
        if (!member) return false;

        const adminRoles = this.config.allowedPunishRoles;
        return member.roles.cache.some(role => adminRoles.includes(role.id));
    }

    /**
     * Sprawdź czy użytkownik może zadać pytanie
     */
    canAsk(userId, member = null) {
        // Administratorzy nie mają limitów
        if (member && this.isAdmin(member)) {
            return { allowed: true, isAdmin: true };
        }

        const now = Date.now();

        // Sprawdź cooldown
        const lastAsk = this.cooldowns.get(userId);
        if (lastAsk) {
            const timeSinceLastAsk = now - lastAsk;
            const cooldownMs = this.cooldownMinutes * 60 * 1000;

            if (timeSinceLastAsk < cooldownMs) {
                const remainingMs = cooldownMs - timeSinceLastAsk;
                const remainingMinutes = Math.ceil(remainingMs / 60000);
                return {
                    allowed: false,
                    reason: `cooldown`,
                    remainingMinutes
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Zapisz że użytkownik zadał pytanie
     */
    recordAsk(userId, member = null) {
        // Administratorzy nie mają limitów - nie zapisuj statystyk
        if (member && this.isAdmin(member)) {
            return;
        }

        const now = Date.now();

        // Zapisz cooldown
        this.cooldowns.set(userId, now);

        // Zapisz do pliku (async, nie czekaj)
        this.saveData().catch(err => {
            logger.error(`Błąd zapisywania AI Chat stats: ${err.message}`);
        });
    }

    /**
     * Zbierz kontekst dla pytania użytkownika
     */
    async gatherContext(message, question) {
        const context = {
            asker: {
                id: message.author.id,
                username: message.author.username,
                displayName: message.member?.displayName || message.author.username,
                roles: message.member?.roles.cache.map(r => r.name) || []
            },
            guild: {
                id: message.guild.id,
                name: message.guild.name
            },
            channel: {
                id: message.channel.id,
                name: message.channel.name
            },
            question: question.toLowerCase()
        };

        // Wykryj klan użytkownika
        const clanKey = this.detectUserClan(message.member);
        if (clanKey) {
            context.asker.clan = clanKey;
            context.asker.clanName = this.config.roleDisplayNames[clanKey];
        }

        // Wykryj o kogo/co pyta (max 2 graczy)
        const mentions = message.mentions.users;
        if (mentions.size > 1) { // >1 bo bot też jest wspomniany
            const mentionedUsersArray = Array.from(mentions.values())
                .filter(u => !u.bot)
                .slice(0, 2); // max 2 graczy

            context.mentionedUsers = [];
            for (const user of mentionedUsersArray) {
                const member = message.guild.members.cache.get(user.id);
                const userInfo = {
                    id: user.id,
                    username: user.username,
                    displayName: member?.displayName || user.username
                };

                const userClan = this.detectUserClan(member);
                if (userClan) {
                    userInfo.clan = userClan;
                    userInfo.clanName = this.config.roleDisplayNames[userClan];
                }

                context.mentionedUsers.push(userInfo);
            }
        }

        // ZAWSZE wykryj nicki w pytaniu (niezależnie od @mentions) - MAX 5 graczy
        // Przykład: "@user Jaki progres zaliczył Slaviax?" -> wykryje "Slaviax" mimo @mention
        const detectedNicks = await this.detectNicknamesInQuestion(question, message.guild.id);
        if (detectedNicks.length > 0) {
            context.detectedPlayers = detectedNicks.map(nick => ({
                id: nick.userId,
                nickname: nick.latestNick,
                displayName: nick.latestNick
            }));
            logger.info(`AI Chat: Wykryto ${detectedNicks.length} nicków w pytaniu: ${detectedNicks.map(n => n.latestNick).join(', ')}`);

            // Dla kompatybilności wstecznej - pierwszy nick jako targetPlayer
            if (detectedNicks.length === 1) {
                context.targetPlayer = context.detectedPlayers[0];
            }
        }

        // Wykryj typ pytania
        context.queryType = this.detectQueryType(question);

        // Wykryj czy pytanie dotyczy siebie
        context.askingAboutSelf = this.isAskingAboutSelf(question);

        // Wykryj dynamiczny okres progresu (np. "z ostatnich 3 tygodni")
        context.requestedWeeks = this.detectRequestedWeeks(question);

        return context;
    }

    /**
     * Wykryj czy użytkownik pyta o siebie
     */
    isAskingAboutSelf(question) {
        const q = question.toLowerCase();

        // Słowa wskazujące na pytanie o siebie
        const selfKeywords = [
            'mnie', 'mój', 'moja', 'moje', 'mojego', 'moją', 'moich', 'mego',
            'ja', 'mną', 'mi', 'mym', 'mymi',
            'mój progres', 'moje statystyki', 'mój klan', 'moje wyniki',
            'jak mi', 'jak u mnie', 'co u mnie', 'gdzie jestem',
            'moja pozycja', 'mój ranking', 'mój wynik'
        ];

        return selfKeywords.some(keyword => q.includes(keyword));
    }

    /**
     * Wykryj żądany okres progresu (np. "z ostatnich 3 tygodni")
     */
    detectRequestedWeeks(question) {
        const q = question.toLowerCase();

        // Wzorce do wykrycia okresu
        const patterns = [
            /ostatni(?:ch|e|ego)?\s*(\d+)\s*tygodn/i,  // "ostatnich 3 tygodni", "ostatnie 5 tygodni"
            /z\s*(\d+)\s*tygodn/i,                     // "z 3 tygodni"
            /(\d+)\s*tygodn(?:i|ie|iowy)/i,            // "3 tygodniowy progres"
            /przez\s*ostatni(?:ch|e)?\s*(\d+)/i        // "przez ostatnie 3"
        ];

        for (const pattern of patterns) {
            const match = q.match(pattern);
            if (match && match[1]) {
                const weeks = parseInt(match[1], 10);
                if (weeks > 0 && weeks <= 52) {
                    return weeks;
                }
            }
        }

        return null; // Brak konkretnego żądania
    }

    /**
     * Wykryj nicki graczy w pytaniu (max 5)
     */
    async detectNicknamesInQuestion(question, guildId) {
        const q = question.toLowerCase();

        // Jeśli pytanie o siebie - nie szukaj nicków
        const selfKeywords = ['mnie', 'mój', 'moja', 'moje', 'ja', 'mojego', 'moją', 'moich', 'mego'];
        if (selfKeywords.some(keyword => q.includes(keyword))) {
            return [];
        }

        // Stop words do pominięcia
        const stopWords = ['o', 'jak', 'co', 'czy', 'ze', 'z', 'w', 'na', 'do', 'dla', 'i', 'a', 'ale',
                          'oraz', 'lub', 'bo', 'że', 'się', 'jest', 'są', 'był', 'była', 'było',
                          'powiedz', 'pokaż', 'jakie', 'jaki', 'jaka', 'który', 'która', 'które',
                          'porównaj', 'vs', 'lepszy', 'gorszy'];

        // Wyciągnij słowa z pytania
        const words = q.split(/\s+/).filter(word => {
            // Usuń znaki interpunkcyjne
            const cleaned = word.replace(/[.,!?;:]/g, '');
            // Pomiń krótkie słowa (< 3 znaki) i stop words
            return cleaned.length >= 3 && !stopWords.includes(cleaned);
        });

        // Spróbuj znaleźć graczy dla każdego słowa (max 5)
        const foundPlayers = [];
        const foundUserIds = new Set(); // Zapobiega duplikatom

        for (const word of words) {
            if (foundPlayers.length >= 5) break; // Max 5 graczy

            try {
                const userInfo = await this.databaseService.findUserIdByNick(guildId, word);
                if (userInfo && !foundUserIds.has(userInfo.userId)) {
                    foundPlayers.push(userInfo); // { userId, latestNick }
                    foundUserIds.add(userInfo.userId);
                }
            } catch (error) {
                // Ignoruj błędy - po prostu to nie jest nick
                continue;
            }
        }

        return foundPlayers;
    }

    /**
     * Wykryj klan użytkownika
     */
    detectUserClan(member) {
        if (!member) return null;

        for (const [key, roleId] of Object.entries(this.config.targetRoles)) {
            if (member.roles.cache.has(roleId)) {
                return key;
            }
        }
        return null;
    }

    /**
     * Wykryj typ pytania
     */
    detectQueryType(question) {
        const q = question.toLowerCase();

        if (q.includes('porównaj') || q.includes('vs') || q.includes('lepszy') || q.includes('gorszy')) {
            return 'compare';
        }
        if (q.includes('progres') || q.includes('rozwój') || q.includes('wzrost') || q.includes('regres')) {
            return 'progress';
        }
        if (q.includes('ranking') || q.includes('top') || q.includes('najlepszy') || q.includes('najgorszy')) {
            return 'ranking';
        }
        if (q.includes('statystyki') || q.includes('stats') || q.includes('jak wygląda')) {
            return 'stats';
        }
        // Rozpoznawanie nazw klanów - różne warianty
        if (q.includes('klan') || q.includes('clan') ||
            q.includes('polski squad') || q.includes('polskisquad') ||
            q.includes('main') || q.includes('główny') ||
            q.includes('dwójka') || q.includes('dwojka') || q.includes('akademia 2') || q.includes('najlepsza akademia') ||
            q.includes('jedynka') || q.includes('akademia 1') ||
            q.includes('zerówka') || q.includes('zerowka') || q.includes('akademia 0') || q.includes('najsłabsza akademia') || q.includes('akademia dla początkujących')) {
            return 'clan';
        }

        return 'general';
    }

    /**
     * Pobierz dane gracza dla AI - WSZYSTKIE dane jak w /progres i /player-status
     */
    async getPlayerData(userId, guildId) {
        try {
            // Pobierz wszystkie dostępne tygodnie
            const allWeeks = await this.databaseService.getAvailableWeeks(guildId);

            if (allWeeks.length === 0) {
                return null;
            }

            // Pobierz ostatnie 12 tygodni dla szczegółowych statystyk
            const last12Weeks = allWeeks.slice(0, 12);

            // Zbierz dane gracza ze wszystkich dostępnych tygodni i klanów
            const playerProgressData = [];

            for (const week of allWeeks) {
                for (const clan of week.clans) {
                    const weekData = await this.databaseService.getPhase1Results(
                        guildId,
                        week.weekNumber,
                        week.year,
                        clan
                    );

                    if (weekData && weekData.players) {
                        const player = weekData.players.find(p => p.userId === userId);

                        if (player) {
                            playerProgressData.push({
                                weekNumber: week.weekNumber,
                                year: week.year,
                                clan: clan,
                                clanName: this.config.roleDisplayNames[clan],
                                score: player.score,
                                displayName: player.displayName,
                                createdAt: weekData.createdAt
                            });
                            break;
                        }
                    }
                }
            }

            if (playerProgressData.length === 0) {
                return null;
            }

            // Sortuj od najnowszego do najstarszego
            playerProgressData.sort((a, b) => {
                if (a.year !== b.year) return b.year - a.year;
                return b.weekNumber - a.weekNumber;
            });

            // Oblicz WSZYSTKIE statystyki jak w /player-status
            const stats = await this.calculatePlayerStats(playerProgressData, userId, guildId, last12Weeks);

            // Oblicz MVP (tygodnie w TOP3 progresu) - uproszczona wersja
            const mvpWeeks = await this.calculateMVPSimple(playerProgressData, userId);

            return {
                userId,
                playerName: playerProgressData[0].displayName,
                recentWeeks: playerProgressData,
                stats,
                mvpWeeks
            };
        } catch (error) {
            logger.error(`Błąd pobierania danych gracza ${userId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Oblicz WSZYSTKIE statystyki gracza - identycznie jak w /player-status
     */
    async calculatePlayerStats(playerProgressData, userId, guildId, last12Weeks) {
        if (!playerProgressData || playerProgressData.length === 0) {
            return null;
        }

        const scores = playerProgressData.map(w => w.score).filter(s => s > 0);
        if (scores.length === 0) return null;

        const latestScore = playerProgressData[0].score;
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);
        const weeksWithData = scores.length;

        // === PROGRESY ===

        // Miesięczny (ostatnie 4 tygodnie vs tydzień 5)
        let monthlyProgress = null;
        let monthlyProgressPercent = null;
        if (playerProgressData.length >= 5) {
            const last4Weeks = playerProgressData.slice(0, 4);
            const currentScore = Math.max(...last4Weeks.map(d => d.score));
            const comparisonScore = playerProgressData[4].score;
            if (comparisonScore > 0) {
                monthlyProgress = currentScore - comparisonScore;
                monthlyProgressPercent = ((monthlyProgress / comparisonScore) * 100).toFixed(1);
            }
        } else if (playerProgressData.length >= 2) {
            const allScores = playerProgressData.map(d => d.score);
            const currentScore = Math.max(...allScores);
            const comparisonScore = playerProgressData[playerProgressData.length - 1].score;
            if (comparisonScore > 0) {
                monthlyProgress = currentScore - comparisonScore;
                monthlyProgressPercent = ((monthlyProgress / comparisonScore) * 100).toFixed(1);
            }
        }

        // Kwartalny (ostatnie 12 tygodni vs tydzień 13)
        let quarterlyProgress = null;
        let quarterlyProgressPercent = null;
        if (playerProgressData.length >= 13) {
            const last12 = playerProgressData.slice(0, 12);
            const currentScore = Math.max(...last12.map(d => d.score));
            const week13Score = playerProgressData[12].score;
            if (week13Score > 0) {
                quarterlyProgress = currentScore - week13Score;
                quarterlyProgressPercent = ((quarterlyProgress / week13Score) * 100).toFixed(1);
            }
        } else if (playerProgressData.length >= 2) {
            const allScores = playerProgressData.map(d => d.score);
            const currentScore = Math.max(...allScores);

            let comparisonScore = 0;
            for (let i = playerProgressData.length - 1; i >= 0; i--) {
                if (playerProgressData[i].score > 0) {
                    comparisonScore = playerProgressData[i].score;
                    break;
                }
            }

            if (comparisonScore > 0) {
                quarterlyProgress = currentScore - comparisonScore;
                quarterlyProgressPercent = ((quarterlyProgress / comparisonScore) * 100).toFixed(1);
            }
        }

        // Największy progres i regres w historii
        let biggestProgress = null;
        let biggestProgressWeek = null;
        let biggestRegress = null;
        let biggestRegressWeek = null;
        let progressWeeksCount = 0;

        if (playerProgressData.length >= 2) {
            let maxProgressDiff = 0;
            let maxRegressDiff = 0;

            for (let i = 0; i < playerProgressData.length; i++) {
                const currentWeek = playerProgressData[i];

                let bestScoreUpToNow = 0;
                for (let j = i + 1; j < playerProgressData.length; j++) {
                    const pastWeek = playerProgressData[j];
                    if (pastWeek.score > bestScoreUpToNow) {
                        bestScoreUpToNow = pastWeek.score;
                    }
                }

                const diff = currentWeek.score - bestScoreUpToNow;

                // Zaangażowanie
                if (i < playerProgressData.length - 1) {
                    if (currentWeek.score === 0) {
                        // 0 punktów
                    } else if (diff > 0) {
                        progressWeeksCount += 1.0;
                    } else if (diff === 0 && bestScoreUpToNow > 0) {
                        progressWeeksCount += 0.8;
                    }
                }

                // Największy progres
                if (bestScoreUpToNow > 0 && diff > maxProgressDiff) {
                    maxProgressDiff = diff;
                    biggestProgress = diff;
                    biggestProgressWeek = `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`;
                }

                // Największy regres
                if (bestScoreUpToNow > 0 && diff < maxRegressDiff) {
                    maxRegressDiff = diff;
                    biggestRegress = diff;
                    biggestRegressWeek = `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`;
                }
            }
        }

        // Współczynnik Zaangażowanie
        let engagementFactor = null;
        const totalComparisons = playerProgressData.length - 1;
        if (totalComparisons > 0) {
            engagementFactor = Math.round((progressWeeksCount / totalComparisons) * 100);
        }

        // === TREND ===
        let trendRatio = null;
        let trendDescription = null;
        let trendIcon = null;

        if (monthlyProgress !== null && quarterlyProgress !== null) {
            const monthlyValue = monthlyProgress;
            const longerTermValue = quarterlyProgress / 3;

            if (longerTermValue !== 0) {
                const adjustedLongerTermValue = longerTermValue < 0 ? Math.abs(longerTermValue) : longerTermValue;
                trendRatio = monthlyValue / adjustedLongerTermValue;

                if (trendRatio >= 1.5) {
                    trendDescription = 'Gwałtownie rosnący';
                    trendIcon = '🚀';
                } else if (trendRatio > 1.1) {
                    trendDescription = 'Rosnący';
                    trendIcon = '↗️';
                } else if (trendRatio >= 0.9) {
                    trendDescription = 'Constans';
                    trendIcon = '⚖️';
                } else if (trendRatio > 0.5) {
                    trendDescription = 'Malejący';
                    trendIcon = '↘️';
                } else {
                    trendDescription = 'Gwałtownie malejący';
                    trendIcon = '🪦';
                }
            }
        }

        // === WSPÓŁCZYNNIKI ===
        // Obliczamy uproszczone wersje współczynników (całkowite wartości zamiast filtrowania po datach)
        let reliabilityFactor = null;
        let punctualityFactor = null;
        let responsivenessFactor = null;

        // Pobierz dane potrzebne do współczynników
        let totalPings = 0;
        let totalConfirmations = 0;
        let lifetimePoints = 0;

        // 1. Pobierz totalPings z reminderUsageService
        if (this.reminderUsageService) {
            try {
                const reminderData = await this.reminderUsageService.getUserReminderData(userId);
                if (reminderData) {
                    totalPings = reminderData.totalPings || 0;
                }
            } catch (error) {
                // Ignoruj błędy
            }
        }

        // 2. Pobierz totalConfirmations z confirmations file
        try {
            const confirmations = await this.loadConfirmations();
            if (confirmations.userStats && confirmations.userStats[userId]) {
                totalConfirmations = confirmations.userStats[userId].totalConfirmations || 0;
            }
        } catch (error) {
            // Ignoruj błędy
        }

        // 3. Pobierz lifetimePoints z punishmentService
        if (this.punishmentService) {
            try {
                const userPunishments = await this.punishmentService.getUserPunishments(guildId, userId);
                if (userPunishments) {
                    lifetimePoints = userPunishments.lifetimePoints || 0;
                }
            } catch (error) {
                // Ignoruj błędy
            }
        }

        // 4. Oblicz współczynniki (jeśli mamy wystarczająco danych)
        const weeksSinceStart = playerProgressData.length;

        if (weeksSinceStart > 0) {
            // Rzetelność: 100% - ((pingi × 0.025 + punkty × 0.2) / tygodnie × 100%)
            const penaltyScore = (totalPings * 0.025) + (lifetimePoints * 0.2);
            const rawReliabilityFactor = (penaltyScore / weeksSinceStart) * 100;
            reliabilityFactor = Math.max(0, 100 - rawReliabilityFactor);

            // Punktualność: 100% - ((pingi × 0.125) / tygodnie × 100%)
            const timingPenaltyScore = totalPings * 0.125;
            const rawPunctualityFactor = (timingPenaltyScore / weeksSinceStart) * 100;
            punctualityFactor = Math.max(0, 100 - rawPunctualityFactor);

            // Responsywność: (potwierdzenia / pingi) × 100%
            if (totalPings > 0) {
                responsivenessFactor = (totalConfirmations / totalPings) * 100;
                responsivenessFactor = Math.min(100, responsivenessFactor);
            } else if (totalPings === 0 && totalConfirmations === 0) {
                responsivenessFactor = 100;
            } else {
                responsivenessFactor = 0;
            }
        }

        return {
            latestScore,
            maxScore,
            minScore,
            weeksWithData,
            monthlyProgress,
            monthlyProgressPercent,
            quarterlyProgress,
            quarterlyProgressPercent,
            biggestProgress,
            biggestProgressWeek,
            biggestRegress,
            biggestRegressWeek,
            engagementFactor,
            trendRatio,
            trendDescription,
            trendIcon,
            reliabilityFactor,
            punctualityFactor,
            responsivenessFactor
        };
    }

    /**
     * Oblicz dynamiczny progres z X ostatnich tygodni
     */
    calculateDynamicProgress(playerProgressData, weeks) {
        if (!playerProgressData || playerProgressData.length < 2 || weeks < 1) {
            return null;
        }

        // Pobierz dane z żądanego okresu
        const recentWeeks = playerProgressData.slice(0, weeks);
        const currentScore = Math.max(...recentWeeks.map(d => d.score).filter(s => s > 0));

        // Znajdź wynik sprzed X tygodni
        if (playerProgressData.length <= weeks) {
            return null; // Za mało danych
        }

        const comparisonWeek = playerProgressData[weeks];
        if (!comparisonWeek || comparisonWeek.score <= 0) {
            return null;
        }

        const progress = currentScore - comparisonWeek.score;
        const progressPercent = ((progress / comparisonWeek.score) * 100).toFixed(1);

        return {
            weeks,
            progress,
            progressPercent,
            fromScore: comparisonWeek.score,
            toScore: currentScore,
            fromWeek: `${comparisonWeek.weekNumber}/${comparisonWeek.year}`,
            toWeek: `${recentWeeks[0].weekNumber}/${recentWeeks[0].year}`
        };
    }

    /**
     * Oblicz MVP uproszczone - tygodnie z największym osobistym progresem
     * (nie wymaga zapytań do bazy dla innych graczy)
     */
    async calculateMVPSimple(playerProgressData, userId) {
        const progressPerWeek = [];

        if (!playerProgressData || playerProgressData.length < 2) {
            return [];
        }

        // Oblicz progres dla każdego tygodnia (porównanie z najlepszym wynikiem przed tym tygodniem)
        for (let i = 0; i < playerProgressData.length - 1; i++) {
            const currentWeek = playerProgressData[i];

            // Znajdź najlepszy wynik przed tym tygodniem
            let bestScoreBefore = 0;
            for (let j = i + 1; j < playerProgressData.length; j++) {
                if (playerProgressData[j].score > bestScoreBefore) {
                    bestScoreBefore = playerProgressData[j].score;
                }
            }

            if (bestScoreBefore > 0) {
                const progress = currentWeek.score - bestScoreBefore;
                progressPerWeek.push({
                    weekNumber: currentWeek.weekNumber,
                    year: currentWeek.year,
                    weekKey: `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`,
                    score: currentWeek.score,
                    progress,
                    progressPercent: ((progress / bestScoreBefore) * 100).toFixed(1),
                    clan: currentWeek.clan,
                    clanName: currentWeek.clanName
                });
            }
        }

        // Sortuj po progresie (malejąco) i zwróć TOP 5 tygodni z największym progresem
        progressPerWeek.sort((a, b) => b.progress - a.progress);

        // Zwróć tylko tygodnie z pozytywnym progresem
        return progressPerWeek.filter(w => w.progress > 0).slice(0, 5);
    }

    /**
     * Oblicz MVP - tygodnie gdzie gracz był w TOP3 progresu swojego klanu
     */
    async calculateMVP(playerProgressData, userId, guildId, last12Weeks) {
        const mvpWeeks = [];

        if (!playerProgressData || playerProgressData.length < 2) {
            return mvpWeeks;
        }

        // Dla każdego tygodnia z ostatnich 12, sprawdź czy gracz był w TOP3
        for (let i = 0; i < Math.min(12, playerProgressData.length); i++) {
            const currentWeek = playerProgressData[i];
            const weekKey = `${currentWeek.year}-${String(currentWeek.weekNumber).padStart(2, '0')}`;

            try {
                // Pobierz dane wszystkich graczy z tego klanu w tym tygodniu
                const weekData = await this.databaseService.getPhase1Results(
                    guildId,
                    currentWeek.weekNumber,
                    currentWeek.year,
                    currentWeek.clan
                );

                if (!weekData || !weekData.players) continue;

                // Oblicz progres dla każdego gracza w tym tygodniu
                const playerProgresses = [];

                for (const player of weekData.players) {
                    // Znajdź najlepszy wynik tego gracza przed tym tygodniem
                    let bestScoreBefore = 0;

                    // Szukaj w historii tego gracza
                    for (const histWeek of playerProgressData) {
                        if (histWeek.year < currentWeek.year ||
                            (histWeek.year === currentWeek.year && histWeek.weekNumber < currentWeek.weekNumber)) {
                            // To jest tydzień przed bieżącym
                            // Sprawdź czy ten gracz ma wynik w tym tygodniu
                            const histData = await this.databaseService.getPhase1Results(
                                guildId,
                                histWeek.weekNumber,
                                histWeek.year,
                                currentWeek.clan
                            );

                            if (histData && histData.players) {
                                const histPlayer = histData.players.find(p => p.userId === player.userId);
                                if (histPlayer && histPlayer.score > bestScoreBefore) {
                                    bestScoreBefore = histPlayer.score;
                                }
                            }
                        }
                    }

                    const progress = player.score - bestScoreBefore;
                    playerProgresses.push({
                        userId: player.userId,
                        displayName: player.displayName,
                        score: player.score,
                        progress
                    });
                }

                // Sortuj po progresie (malejąco)
                playerProgresses.sort((a, b) => b.progress - a.progress);

                // Sprawdź czy nasz gracz jest w TOP3
                const top3 = playerProgresses.slice(0, 3);
                const userInTop3 = top3.findIndex(p => p.userId === userId);

                if (userInTop3 !== -1) {
                    const userData = top3[userInTop3];
                    mvpWeeks.push({
                        weekNumber: currentWeek.weekNumber,
                        year: currentWeek.year,
                        weekKey: `${String(currentWeek.weekNumber).padStart(2, '0')}/${String(currentWeek.year).slice(-2)}`,
                        position: userInTop3 + 1,
                        score: userData.score,
                        progress: userData.progress,
                        clan: currentWeek.clan,
                        clanName: currentWeek.clanName
                    });
                }
            } catch (error) {
                // Ignoruj błędy dla pojedynczych tygodni
                continue;
            }
        }

        return mvpWeeks;
    }

    /**
     * Pobierz ranking klanu dla AI (TOP X z ostatniego tygodnia)
     */
    async getClanRanking(clanKey, guildId, limit = 10) {
        try {
            // Pobierz najnowszy tydzień
            const allWeeks = await this.databaseService.getAvailableWeeks(guildId);

            if (allWeeks.length === 0) {
                return [];
            }

            const latestWeek = allWeeks[0];

            // Pobierz wyniki dla tego klanu w najnowszym tygodniu
            const weekData = await this.databaseService.getPhase1Results(
                guildId,
                latestWeek.weekNumber,
                latestWeek.year,
                clanKey
            );

            if (!weekData || !weekData.players) {
                return [];
            }

            // Sortuj graczy po score
            const ranking = weekData.players
                .map(player => ({
                    userId: player.userId,
                    playerName: player.displayName,
                    score: player.score
                }))
                .sort((a, b) => b.score - a.score);

            return ranking.slice(0, limit);
        } catch (error) {
            logger.error(`Błąd pobierania rankingu klanu ${clanKey}: ${error.message}`);
            return [];
        }
    }

    /**
     * Pobierz SZCZEGÓŁOWE dane klanu - WSZYSCY gracze ze WSZYSTKICH tygodni
     */
    async getClanDetailedData(clanKey, guildId) {
        try {
            // Pobierz wszystkie dostępne tygodnie
            const allWeeks = await this.databaseService.getAvailableWeeks(guildId);

            if (allWeeks.length === 0) {
                return null;
            }

            // Zbierz dane wszystkich graczy klanu ze wszystkich tygodni
            const playersMap = new Map(); // userId -> {playerName, weeks: [{weekNumber, year, score}]}

            for (const week of allWeeks) {
                const weekData = await this.databaseService.getPhase1Results(
                    guildId,
                    week.weekNumber,
                    week.year,
                    clanKey
                );

                if (weekData && weekData.players) {
                    for (const player of weekData.players) {
                        if (!player.userId) continue;

                        if (!playersMap.has(player.userId)) {
                            playersMap.set(player.userId, {
                                playerName: player.displayName,
                                weeks: []
                            });
                        }

                        playersMap.get(player.userId).weeks.push({
                            weekNumber: week.weekNumber,
                            year: week.year,
                            score: player.score
                        });
                    }
                }
            }

            // Oblicz statystyki dla każdego gracza
            const players = [];
            for (const [userId, data] of playersMap.entries()) {
                const scores = data.weeks.map(w => w.score).filter(s => s > 0);
                if (scores.length === 0) continue;

                const latestWeek = data.weeks[0];
                const latestScore = latestWeek.score;
                const maxScore = Math.max(...scores);
                const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

                players.push({
                    userId,
                    playerName: data.playerName,
                    latestScore,
                    maxScore,
                    avgScore,
                    weeksCount: scores.length
                });
            }

            // Sortuj po najlepszym wyniku
            players.sort((a, b) => b.maxScore - a.maxScore);

            // Oblicz statystyki klanu
            const clanStats = {
                totalPlayers: players.length,
                avgMaxScore: players.length > 0 ? Math.round(players.reduce((sum, p) => sum + p.maxScore, 0) / players.length) : 0,
                avgLatestScore: players.length > 0 ? Math.round(players.reduce((sum, p) => sum + p.latestScore, 0) / players.length) : 0,
                topScore: players.length > 0 ? players[0].maxScore : 0
            };

            return {
                clanKey,
                clanName: this.config.roleDisplayNames[clanKey],
                players,
                stats: clanStats,
                weeksCount: allWeeks.length
            };
        } catch (error) {
            logger.error(`Błąd pobierania szczegółowych danych klanu ${clanKey}: ${error.message}`);
            return null;
        }
    }

    /**
     * Pobierz obecny tydzień (ISO)
     */
    getCurrentWeek() {
        const now = new Date();
        const year = now.getFullYear();

        // ISO week calculation
        const firstDayOfYear = new Date(year, 0, 1);
        const pastDaysOfYear = (now - firstDayOfYear) / 86400000;
        const weekNumber = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);

        return { weekNumber, year };
    }

    /**
     * Przygotuj prompt dla AI
     */
    async preparePrompt(context, message) {
        let prompt = `Jesteś Botem Stalker, który zarządza statystykami człownków klanu Polski Squad w grze Survivor.io.

KRYTYCZNE ZASADY - ŚCISŁE PRZESTRZEGANIE:
- Odpowiadaj ZAWSZE po polsku
- Bądź pomocny, ale też dowcipny, gdy jest to stosowne
- możesz przeklinać, tylko ze smakiem
- możesz być zadziorny, ale elokwentny
- Używaj emoji do urozmaicenia odpowiedzi

⛔ ABSOLUTNY ZAKAZ WYMYŚLANIA DANYCH ⛔
- Możesz używać WYŁĄCZNIE liczb, nazw graczy i statystyk które dostałeś poniżej w sekcji "DANE"
- Jeśli użytkownik pyta o dane których NIE MASZ w sekcji "DANE" - powiedz że nie masz tych informacji
- NIE wymyślaj nazw graczy, wyników, statystyk ani jakichkolwiek liczb
- używaj tylko faktów z danych
- Jeśli ranking ma tylko 5 graczy - nie możesz pokazać "więcej graczy" bo ich NIE MASZ
- Dane dotyczą wyników z Lunar Mine Expedition
- Wyniki to punkty zdobyte w walce z Bossami

KONTEKST PYTANIA:
Użytkownik: ${context.asker.displayName} (${context.asker.username})
${context.asker.clanName ? `Klan: ${context.asker.clanName}` : 'Klan: brak'}
Pytanie: ${context.question}
Typ pytania: ${context.queryType}

STRUKTURA KLANÓW I ROZPOZNAWANIE NAZW:
Polski Squad ma 4 klany z różnymi nazwami w pytaniach użytkownika:

1. 🔥 Polski Squad (Main Klan) - NAZWY: "polski squad", "main", "główny klan", "najlepszy klan"
   → Najsilniejsi gracze, pierwszy poziom zaawansowania

2. 💥 PolskiSquad² (Akademia 2) - NAZWY: "dwójka", "dwojka", "akademia 2", "najlepsza akademia"
   → Drugi poziom zaawansowania, silni gracze

3. ⚡ PolskiSquad¹ (Akademia 1) - NAZWY: "jedynka", "akademia 1"
   → Trzeci poziom zaawansowania, średnio zaawansowani gracze

4. 🎮 PolskiSquad⁰ (Akademia 0) - NAZWY: "zerówka", "zerowka", "akademia 0", "najsłabsza akademia", "akademia dla początkujących"
   → Czwarty poziom, klan dla początkujących graczy

Hierarchia: Main > Akademia 2 > Akademia 1 > Akademia 0
Gracze awansują między klanami na podstawie swoich wyników w Lunar Mine Expedition.

LIMITY PORÓWNAŃ:
- Możesz porównać maksymalnie 5 graczy jednocześnie
- Użytkownik może wspomnieć (@mention) do 5 graczy w pytaniu
- Przy porównaniu zawsze podawane są dane wszystkich dostępnych graczy

ROZPOZNAWANIE PYTAŃ O SIEBIE:
- Gdy użytkownik używa słów: "mój", "moje", "mnie", "ja", "mojego", "moją", "mój progres", "moje statystyki", "mój klan", "moje wyniki"
  → ZAWSZE odpowiadaj o PYTAJĄCYM (${context.asker.displayName}), niezależnie od innych wzmianek w pytaniu
- Gdy pytanie zawiera "porównaj mnie z X" → porównaj PYTAJĄCEGO z graczem X
- Gdy pytanie to tylko "mój progres" lub "jak mi idzie" bez innych nicków → pokaż dane PYTAJĄCEGO

DYNAMICZNY PROGRES:
- Gdy użytkownik pyta o "progres z ostatnich X tygodni" → oblicz i pokaż progres z dokładnie tego okresu
- Porównaj najlepszy wynik z ostatnich X tygodni z wynikiem sprzed X tygodni
- Przykład: "progres z ostatnich 3 tygodni" = najlepszy wynik z ostatnich 3 tyg vs wynik sprzed 3 tyg

WSPÓŁCZYNNIKI DO PORÓWNAŃ:
- 📊 Zaangażowanie (%) - procent tygodni gdzie gracz zrobił progres
- 📈 Trend - czy progres rośnie, spada, czy jest stały (🚀↗️⚖️↘️🪦)
- ⭐ MVP - tygodnie z największym osobistym progresem (TOP wyniki gracza)
- 🎯 Rzetelność (%) - regularność uczestnictwa w bossach
- ⏰ Punktualność (%) - czy gracz potwierdza na czas
- 📬 Responsywność (%) - odpowiedzi na przypomnienia
`;

        // Dodaj dane gracza którego dotyczy pytanie
        if (['stats', 'progress'].includes(context.queryType)) {
            // PRIORYTET: 1) Pytanie o siebie (mój, moje, mnie), 2) Wykryty nick, 3) @mention, 4) Pytający
            let targetUserId, targetName;

            if (context.askingAboutSelf) {
                // NAJWYŻSZY PRIORYTET - użytkownik pyta o siebie (mój, moje, mnie, ja)
                targetUserId = context.asker.id;
                targetName = context.asker.displayName;
                logger.info(`AI Chat: Pytanie o siebie - używam danych pytającego (${targetName})`);
            } else if (context.detectedPlayers && context.detectedPlayers.length > 0) {
                // Drugi priorytet - nick wykryty w pytaniu (np. "progres Slaviax")
                targetUserId = context.detectedPlayers[0].id;
                targetName = context.detectedPlayers[0].displayName;
            } else if (context.mentionedUsers && context.mentionedUsers.length > 0 && context.mentionedUsers[0].id !== context.asker.id) {
                // Trzeci priorytet - @mention (ale nie sam siebie)
                targetUserId = context.mentionedUsers[0].id;
                targetName = context.mentionedUsers[0].displayName;
            } else if (context.targetPlayer) {
                // Fallback - kompatybilność wsteczna
                targetUserId = context.targetPlayer.id;
                targetName = context.targetPlayer.displayName;
            } else {
                // Ostateczny fallback - pytający
                targetUserId = context.asker.id;
                targetName = context.asker.displayName;
            }

            // Użyj nowych funkcji pomocniczych z interactionHandlers
            if (this.helperFunctions.generatePlayerProgressTextData && this.helperFunctions.generatePlayerStatusTextData) {
                const sharedState = {
                    config: this.config,
                    databaseService: this.databaseService,
                    reminderUsageService: this.reminderUsageService,
                    punishmentService: this.punishmentService
                };

                // Pobierz dane z /progres
                const progressResult = await this.helperFunctions.generatePlayerProgressTextData(
                    targetUserId,
                    context.guild.id,
                    sharedState
                );

                // Pobierz dane z /player-status
                const statusResult = await this.helperFunctions.generatePlayerStatusTextData(
                    targetUserId,
                    context.guild.id,
                    sharedState
                );

                if (progressResult.success && statusResult.success) {
                    // Dodaj dane z /progres
                    prompt += `\n${progressResult.plainText}\n`;

                    // Dodaj dane z /player-status
                    prompt += `\n${statusResult.plainText}\n`;

                    logger.info(`AI Chat: Pobrano dane dla gracza (userId: ${targetUserId}) z /progres i /player-status`);
                } else {
                    prompt += `\nDANE GRACZA (${targetName}): Nie znaleziono żadnych wyników w bazie danych.\n`;
                    logger.warn(`AI Chat: Brak danych dla userId ${targetUserId}`);
                }
            } else {
                // Fallback - stary system (nie powinien się zdarzyć)
                prompt += `\n⚠️ BŁĄD: Brak dostępu do funkcji pomocniczych.\n`;
                logger.error(`AI Chat: Brak helperFunctions - sprawdź inicjalizację serwisu`);
            }

            // Instrukcja czy porównywać z pytającym
            if (context.targetPlayer) {
                prompt += `\n⚠️ LIMIT DANYCH: Pytanie dotyczy gracza ${targetName}. NIE porównuj z użytkownikiem ${context.asker.displayName}!\n`;
                prompt += `Użytkownik pyta o INNEGO gracza - odpowiedz TYLKO o tego gracza, bez porównań z pytającym.\n`;
            } else {
                prompt += `\n⚠️ LIMIT DANYCH: Masz dane TYLKO tego jednego gracza (${targetName}). NIE MA danych innych graczy - NIE wymyślaj!\n`;
            }
        }

        // Dodaj dane dla porównania (max 2 graczy)
        if (context.queryType === 'compare') {
            const playersToCompare = [];
            const addedUserIds = new Set(); // Zapobiegaj duplikatom

            // Jeśli pytanie o siebie ("porównaj mnie z X") - ZAWSZE dodaj pytającego jako pierwszego
            if (context.askingAboutSelf) {
                playersToCompare.push({ id: context.asker.id, name: context.asker.displayName });
                addedUserIds.add(context.asker.id);
                logger.info(`AI Chat: Porównanie - dodaję pytającego (${context.asker.displayName}) jako pierwszego`);
            }

            // Jeśli są wspomnienia (@mention) - dodaj wspomnianych graczy (max 2 łącznie)
            if (context.mentionedUsers && context.mentionedUsers.length > 0) {
                for (const user of context.mentionedUsers.slice(0, 2)) {
                    if (!addedUserIds.has(user.id) && playersToCompare.length < 2) {
                        playersToCompare.push({ id: user.id, name: user.displayName });
                        addedUserIds.add(user.id);
                    }
                }
            }
            // Jeśli wykryto nicki w pytaniu - dodaj znalezionych graczy
            else if (context.detectedPlayers && context.detectedPlayers.length > 0) {
                for (const player of context.detectedPlayers.slice(0, 2)) {
                    if (!addedUserIds.has(player.id) && playersToCompare.length < 2) {
                        playersToCompare.push({ id: player.id, name: player.displayName });
                        addedUserIds.add(player.id);
                    }
                }
            }
            // Jeśli wykryto targetPlayer (kompatybilność wsteczna)
            else if (context.targetPlayer && !addedUserIds.has(context.targetPlayer.id)) {
                playersToCompare.push({ id: context.targetPlayer.id, name: context.targetPlayer.displayName });
            }
            // W ostateczności użyj pytającego jeśli jeszcze nie dodany
            else if (!addedUserIds.has(context.asker.id)) {
                playersToCompare.push({ id: context.asker.id, name: context.asker.displayName });
            }

            // Pobierz pełne dane dla każdego gracza (max 2) używając helper functions
            const sharedState = {
                config: this.config,
                databaseService: this.databaseService,
                reminderUsageService: this.reminderUsageService,
                punishmentService: this.punishmentService
            };

            let loadedPlayersCount = 0;
            for (let i = 0; i < playersToCompare.length; i++) {
                const player = playersToCompare[i];
                const playerLabel = i === 0 ? 'PIERWSZEGO' : 'DRUGIEGO';

                // Użyj helper functions aby pobrać pełne dane
                const progressResult = await this.helperFunctions.generatePlayerProgressTextData(
                    player.id,
                    context.guild.id,
                    sharedState
                );

                const statusResult = await this.helperFunctions.generatePlayerStatusTextData(
                    player.id,
                    context.guild.id,
                    sharedState
                );

                if (progressResult.success && statusResult.success) {
                    prompt += `\n=== ${playerLabel} GRACZ ===\n`;
                    prompt += progressResult.plainText + '\n';
                    prompt += statusResult.plainText + '\n';

                    logger.info(`AI Chat: Pobrano pełne dane dla ${progressResult.data.latestNick} - ${progressResult.data.weeksWithData} tygodni`);
                    loadedPlayersCount++;
                } else {
                    prompt += `\n=== ${playerLabel} GRACZ: ${player.name} ===\n`;
                    prompt += `❌ Nie znaleziono żadnych wyników w bazie danych.\n`;
                    logger.warn(`AI Chat: Brak danych dla ${playerLabel.toLowerCase()} gracza userId ${player.id}`);
                }
            }

            const totalCompared = playersToCompare.length;
            prompt += `\n⚠️ LIMIT DANYCH: Masz ${totalCompared === 1 ? 'TYLKO tego jednego gracza' : `TYLKO tych ${totalCompared} graczy`} do porównania (max 2). NIE MA więcej danych - NIE wymyślaj innych graczy!\n`;
        }

        // Dodaj SZCZEGÓŁOWE dane klanów jeśli pytanie o ranking/klan
        if (['ranking', 'clan'].includes(context.queryType)) {
            // Pobierz szczegółowe dane wszystkich 4 klanów
            const clans = ['TARGET_ROLE_MAIN', 'TARGET_ROLE_2', 'TARGET_ROLE_1', 'TARGET_ROLE_0'];
            const clanNames = {
                'TARGET_ROLE_MAIN': 'Polski Squad (Main Klan)',
                'TARGET_ROLE_2': 'PolskiSquad² (Akademia 2)',
                'TARGET_ROLE_1': 'PolskiSquad¹ (Akademia 1)',
                'TARGET_ROLE_0': 'PolskiSquad⁰ (Akademia 0)'
            };
            let totalPlayers = 0;

            for (const clanKey of clans) {
                const clanData = await this.getClanDetailedData(clanKey, context.guild.id);
                if (clanData && clanData.players.length > 0) {
                    prompt += `\n=== ${clanNames[clanKey]} ===\n`;
                    prompt += `📊 STATYSTYKI KLANU:\n`;
                    prompt += `- Liczba graczy: ${clanData.stats.totalPlayers}\n`;
                    prompt += `- Najlepszy wynik: ${clanData.stats.topScore} pkt\n`;
                    prompt += `- Średni max wynik: ${clanData.stats.avgMaxScore} pkt\n`;
                    prompt += `- Średni ostatni wynik: ${clanData.stats.avgLatestScore} pkt\n`;
                    prompt += `- Dostępne tygodnie: ${clanData.weeksCount}\n\n`;

                    prompt += `👥 GRACZE (TOP 15):\n`;
                    const top15 = clanData.players.slice(0, 15);
                    top15.forEach((player, idx) => {
                        prompt += `${idx + 1}. ${player.playerName} - Max: ${player.maxScore} pkt | Ostatni: ${player.latestScore} pkt | Średnia: ${player.avgScore} pkt\n`;
                    });

                    if (clanData.players.length > 15) {
                        prompt += `... i ${clanData.players.length - 15} więcej graczy\n`;
                    }

                    totalPlayers += clanData.players.length;

                    logger.info(`AI Chat: Pobrano dane klanu ${clanKey} - ${clanData.players.length} graczy, ${clanData.weeksCount} tygodni`);
                }
            }

            if (totalPlayers > 0) {
                prompt += `\n⚠️ LIMIT DANYCH: Masz dane ${totalPlayers} graczy ze wszystkich 4 klanów. Każdy klan ma TOP 15 graczy pokazanych + info ile jest więcej. NIE wymyślaj innych graczy!\n`;
            } else {
                prompt += `\n⚠️ BRAK DANYCH: Nie znaleziono danych klanów.\n`;
            }
        }

        // Dodaj instrukcje specyficzne dla typu pytania
        prompt += `\n\n⛔ ZADANIE - ŚCISŁE PRZESTRZEGANIE ⛔\n`;
        prompt += `Odpowiedz na pytanie użytkownika TYLKO na podstawie danych powyżej.\n`;

        // Specyficzne instrukcje dla każdego typu pytania
        if (context.queryType === 'compare') {
            prompt += `\n📊 TYP PYTANIA: PORÓWNANIE GRACZY\n`;
            prompt += `- Porównaj dokładnie tych graczy których dane dostałeś powyżej\n`;
            prompt += `- Pokaż różnice w wynikach, progresach, trendach i zaangażowaniu\n`;
            prompt += `- Dla tabel/porównań KONIECZNIE użyj bloku kodu Discord (otocz \`\`\`)\n`;
            prompt += `- Format tabeli w bloku kodu: proste kolumny oddzielone spacjami, bez ramek markdown\n`;
            prompt += `- Przykład bloku kodu:\n\`\`\`\nStatystyka          Gracz1     Gracz2\n─────────────────────────────────────\nOstatni wynik       2045 pkt   2457 pkt\nNajlepszy wynik     2045 pkt   2457 pkt\n\`\`\`\n`;
            prompt += `- Wskaż który gracz jest lepszy i dlaczego (np. wyższy progres, lepszy trend)\n`;
            prompt += `- ⚠️ KRYTYCZNE: Jeśli użytkownik pyta o konkretny okres (np. "ostatnie 2 tygodnie", "ostatni miesiąc") - odpowiedz TYLKO o ten okres!\n`;
            prompt += `- Oblicz progres dla DOKŁADNIE tego okresu używając sekcji OSTATNIE WYNIKI\n`;
            prompt += `- NIE pokazuj progresu miesięcznego/kwartalnego gdy użytkownik pyta o inny okres!\n`;
        } else if (context.queryType === 'progress') {
            prompt += `\n📈 TYP PYTANIA: PROGRES GRACZA\n`;
            prompt += `- Opisz jak zmienia się wynik gracza w czasie\n`;
            prompt += `- ⚠️ KRYTYCZNE: Jeśli użytkownik pyta o konkretny okres (np. "ostatnie 2 tygodnie", "ostatni miesiąc") - odpowiedz TYLKO o ten okres!\n`;
            prompt += `- Oblicz progres dla DOKŁADNIE tego okresu używając sekcji OSTATNIE WYNIKI (weź wynik z najnowszego tygodnia minus wynik sprzed X tygodni)\n`;
            prompt += `- NIE pokazuj progresu miesięcznego/kwartalnego gdy użytkownik pyta o inny konkretny okres!\n`;
            prompt += `- Jeśli użytkownik NIE precyzuje okresu - WTEDY pokaż progres miesięczny, kwartalny, trend\n`;
            prompt += `- Wskaż trend (rosnący, malejący, constans) i co to oznacza\n`;
        } else if (context.queryType === 'stats') {
            prompt += `\n📊 TYP PYTANIA: STATYSTYKI GRACZA\n`;
            prompt += `- Pokaż wszystkie dostępne statystyki gracza (wyniki, progresy, trend, zaangażowanie)\n`;
            prompt += `- Użyj emoji i formatowania dla lepszej czytelności\n`;
            prompt += `- Dodaj krótkie wyjaśnienie co oznaczają poszczególne współczynniki\n`;
            prompt += `- Wskaż mocne i słabe strony gracza\n`;
        } else if (context.queryType === 'ranking') {
            prompt += `\n🏆 TYP PYTANIA: RANKINGI\n`;
            prompt += `- Pokaż ranking graczy z dostępnych danych\n`;
            prompt += `- Użyj numeracji (1., 2., 3., ...) i wyników w punktach\n`;
            prompt += `- Jeśli użytkownik pyta o TOP X - pokaż dokładnie tyle graczy ile masz\n`;
            prompt += `- Możesz porównać rankingi różnych klanów jeśli masz dane\n`;
        } else if (context.queryType === 'clan') {
            prompt += `\n🏰 TYP PYTANIA: KLANY\n`;
            prompt += `- Rozpoznaj nazwy klanów w pytaniu:\n`;
            prompt += `  * Polski Squad / Main / główny klan = Polski Squad (Main Klan)\n`;
            prompt += `  * dwójka / najlepsza akademia / akademia 2 = PolskiSquad² (Akademia 2)\n`;
            prompt += `  * jedynka / akademia 1 = PolskiSquad¹ (Akademia 1)\n`;
            prompt += `  * zerówka / najsłabsza akademia / akademia 0 = PolskiSquad⁰ (Akademia 0)\n`;
            prompt += `- Masz PEŁNE dane każdego klanu: wszystkich graczy, ich wyniki ze wszystkich tygodni, statystyki klanu\n`;
            prompt += `- Porównaj klany używając statystyk: liczba graczy, najlepszy wynik, średnie wyniki\n`;
            prompt += `- Pokaż TOP graczy z każdego klanu (masz TOP 15 + info ile jest więcej)\n`;
            prompt += `- Wyjaśnij hierarchię: Main (najlepsi) > Akademia 2 (silni) > Akademia 1 (średni) > Akademia 0 (początkujący)\n`;
            prompt += `- Gracze awansują między klanami na podstawie wyników\n`;
        } else {
            prompt += `\n💬 TYP PYTANIA: OGÓLNE\n`;
            prompt += `- Odpowiedz naturalnie i pomocnie\n`;
            prompt += `- Jeśli pytanie wykracza poza dane - powiedz że nie masz tych informacji\n`;
            prompt += `- Możesz wyjaśnić jak działa system, co oznaczają statystyki itp.\n`;
        }

        prompt += `\n⚠️ PAMIĘTAJ:\n`;
        prompt += `- Jeśli pytanie dotyczy danych których NIE MASZ - powiedz "Nie mam tych informacji w bazie"\n`;
        prompt += `- Jeśli użytkownik pyta o "więcej graczy" a podałeś już wszystkich - powiedz "To wszystkie dane które mam"\n`;
        prompt += `- NIE wymyślaj nazwisk, wyników ani statystyk - używaj TYLKO faktów z sekcji "DANE"\n`;
        prompt += `- FORMATOWANIE: Dla tabel ZAWSZE używaj bloku kodu \`\`\` ... \`\`\` (bez ramek markdown | --- |)\n`;
        prompt += `- OKRES CZASU: Jeśli użytkownik pyta o konkretny okres (np. "2 tygodnie") - odpowiedz TYLKO o ten okres, NIE o miesięczny/kwartalny\n`;
        prompt += `- Odpowiedź powinna być zwięzła (max 1500 znaków), pomocna i sformatowana jako wiadomość Discord (markdown)\n`;
        prompt += `- Używaj emoji 🎯📈📊🏆💪 do urozmaicenia, ale nie przesadzaj\n`;

        return prompt;
    }

    /**
     * Zadaj pytanie AI (główna metoda)
     */
    async ask(message, question) {
        // Sprawdź czy enabled
        if (!this.enabled) {
            return '⚠️ AI Chat jest obecnie wyłączony. Skontaktuj się z administratorem.';
        }

        const userId = message.author.id;

        try {
            // Zbierz kontekst
            const context = await this.gatherContext(message, question);

            // Przygotuj prompt (system + dane)
            const prompt = await this.preparePrompt(context, message);

            // Pobierz historię konwersacji (jeśli aktywna w ciągu ostatniej godziny)
            const conversationHistory = this.getConversationHistory(userId);
            const hasHistory = conversationHistory.length > 0;

            // Zbuduj tablicę wiadomości
            let messages = [];

            if (hasHistory) {
                // Dodaj informację o kontynuacji rozmowy do promptu
                const continuationNote = `\n\n📝 KONTEKST ROZMOWY:\nTo jest kontynuacja poprzedniej rozmowy. Poniżej znajduje się historia ostatnich wymian.\nPamiętaj o wcześniejszym kontekście przy odpowiadaniu.\n`;

                // Dodaj historię konwersacji
                messages = [...conversationHistory];

                // Dodaj nowe pytanie z pełnym kontekstem danych
                messages.push({
                    role: 'user',
                    content: prompt + continuationNote
                });

                logger.info(`AI Chat: Kontynuacja rozmowy dla ${context.asker.username} (${conversationHistory.length / 2} poprzednich wymian)`);
            } else {
                // Pierwsza wiadomość - wysyłamy pełny prompt
                messages.push({
                    role: 'user',
                    content: prompt
                });
            }

            // Loguj pełny prompt wysyłany do API
            const lastMessage = messages[messages.length - 1];
            logger.info(`\n${'='.repeat(80)}\n📤 PROMPT WYSYŁANY DO AI:\n${'='.repeat(80)}\n${lastMessage.content}\n${'='.repeat(80)}`);

            // Wywołaj API
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                messages: messages,
                temperature: 0.7
            });

            // Wyciągnij odpowiedź
            const answer = response.content[0].text;

            // Zapisz do historii konwersacji (uproszczone pytanie + odpowiedź)
            // Używamy oryginalnego pytania użytkownika, nie pełnego promptu z danymi
            this.addToConversationHistory(userId, question, answer);

            // Log usage
            logger.info(`AI Chat: ${context.asker.username} zadał pytanie (typ: ${context.queryType})${hasHistory ? ' [kontynuacja]' : ''}`);

            return answer;

        } catch (error) {
            logger.error(`Błąd AI Chat: ${error.message}`);

            if (error.status === 401) {
                return '⚠️ Błąd autoryzacji API. Skontaktuj się z administratorem.';
            } else if (error.status === 429) {
                return '⚠️ Przekroczono limit API. Spróbuj ponownie za chwilę.';
            } else if (error.status === 500) {
                return '⚠️ Problem z serwerem API. Spróbuj ponownie za chwilę.';
            }

            return '⚠️ Wystąpił błąd podczas przetwarzania pytania. Spróbuj ponownie.';
        }
    }
}

module.exports = AIChatService;
