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
    constructor(config, databaseService) {
        this.config = config;
        this.databaseService = databaseService;

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
        this.cooldownMinutes = 15; // 15 minut
        this.dailyLimit = 20; // 20 pytań dziennie

        // Persistent storage
        this.dataDir = path.join(__dirname, '../data');
        this.cooldownsFile = path.join(this.dataDir, 'ai_chat_cooldowns.json');
        this.dailyUsageFile = path.join(this.dataDir, 'ai_chat_daily_usage.json');

        // In-memory cache
        this.cooldowns = new Map(); // userId -> timestamp
        this.dailyUsage = new Map(); // userId -> {date: string, count: number}

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

            // Daily usage
            try {
                const usageData = await fs.readFile(this.dailyUsageFile, 'utf8');
                const parsed = JSON.parse(usageData);
                this.dailyUsage = new Map(Object.entries(parsed));
            } catch (err) {
                // Plik nie istnieje - OK
                this.dailyUsage = new Map();
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

            // Daily usage
            const usageObj = Object.fromEntries(this.dailyUsage);
            await fs.writeFile(this.dailyUsageFile, JSON.stringify(usageObj, null, 2));
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

        // Usuń stare daily usage (zachowaj tylko dzisiejszy)
        const today = new Date().toISOString().split('T')[0];
        for (const [userId, data] of this.dailyUsage.entries()) {
            if (data.date !== today) {
                this.dailyUsage.delete(userId);
            }
        }
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

        // Sprawdź daily limit
        const today = new Date().toISOString().split('T')[0];
        const usage = this.dailyUsage.get(userId);

        if (usage && usage.date === today && usage.count >= this.dailyLimit) {
            return {
                allowed: false,
                reason: `daily_limit`,
                limit: this.dailyLimit
            };
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
        const today = new Date().toISOString().split('T')[0];

        // Zapisz cooldown
        this.cooldowns.set(userId, now);

        // Zapisz daily usage
        const usage = this.dailyUsage.get(userId);
        if (usage && usage.date === today) {
            usage.count++;
        } else {
            this.dailyUsage.set(userId, { date: today, count: 1 });
        }

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

        // Wykryj o kogo/co pyta
        const mentions = message.mentions.users;
        if (mentions.size > 1) { // >1 bo bot też jest wspomniany
            const mentionedUser = Array.from(mentions.values()).find(u => !u.bot);
            if (mentionedUser) {
                const member = message.guild.members.cache.get(mentionedUser.id);
                context.mentionedUser = {
                    id: mentionedUser.id,
                    username: mentionedUser.username,
                    displayName: member?.displayName || mentionedUser.username
                };

                const mentionedClan = this.detectUserClan(member);
                if (mentionedClan) {
                    context.mentionedUser.clan = mentionedClan;
                    context.mentionedUser.clanName = this.config.roleDisplayNames[mentionedClan];
                }
            }
        }

        // Wykryj nick w pytaniu (jeśli nie ma @mention)
        // Przykład: "powiedz coś o thashar" -> wykryje "thashar"
        if (!context.mentionedUser) {
            const detectedNick = await this.detectNicknameInQuestion(question, message.guild.id);
            if (detectedNick) {
                context.targetPlayer = {
                    id: detectedNick.userId,
                    nickname: detectedNick.latestNick,
                    displayName: detectedNick.latestNick
                };
                logger.info(`AI Chat: Wykryto nick w pytaniu: ${detectedNick.latestNick} (userId: ${detectedNick.userId})`);
            }
        }

        // Wykryj typ pytania
        context.queryType = this.detectQueryType(question);

        return context;
    }

    /**
     * Wykryj nick gracza w pytaniu
     */
    async detectNicknameInQuestion(question, guildId) {
        const q = question.toLowerCase();

        // Jeśli pytanie o siebie - nie szukaj nicku
        const selfKeywords = ['mnie', 'mój', 'moja', 'moje', 'ja', 'mojego', 'moją', 'moich', 'mego'];
        if (selfKeywords.some(keyword => q.includes(keyword))) {
            return null;
        }

        // Stop words do pominięcia
        const stopWords = ['o', 'jak', 'co', 'czy', 'ze', 'z', 'w', 'na', 'do', 'dla', 'i', 'a', 'ale',
                          'oraz', 'lub', 'bo', 'że', 'się', 'jest', 'są', 'był', 'była', 'było',
                          'powiedz', 'pokaż', 'jakie', 'jaki', 'jaka', 'który', 'która', 'które'];

        // Wyciągnij słowa z pytania
        const words = q.split(/\s+/).filter(word => {
            // Usuń znaki interpunkcyjne
            const cleaned = word.replace(/[.,!?;:]/g, '');
            // Pomiń krótkie słowa (< 3 znaki) i stop words
            return cleaned.length >= 3 && !stopWords.includes(cleaned);
        });

        // Spróbuj znaleźć gracza dla każdego słowa
        for (const word of words) {
            try {
                const userInfo = await this.databaseService.findUserIdByNick(guildId, word);
                if (userInfo) {
                    return userInfo; // { userId, latestNick }
                }
            } catch (error) {
                // Ignoruj błędy - po prostu to nie jest nick
                continue;
            }
        }

        return null;
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

        if (q.includes('porównaj') || q.includes('vs') || q.includes('lepszy')) {
            return 'compare';
        }
        if (q.includes('progres') || q.includes('rozwój') || q.includes('wzrost')) {
            return 'progress';
        }
        if (q.includes('ranking') || q.includes('top') || q.includes('najlepszy') || q.includes('najgorszy')) {
            return 'ranking';
        }
        if (q.includes('statystyki') || q.includes('stats') || q.includes('jak wygląda')) {
            return 'stats';
        }
        if (q.includes('klan') || q.includes('clan')) {
            return 'clan';
        }

        return 'general';
    }

    /**
     * Pobierz dane gracza dla AI
     */
    async getPlayerData(userId, guildId) {
        try {
            // Pobierz wszystkie dostępne tygodnie (ostatnie 12)
            const allWeeks = await this.databaseService.getAvailableWeeks(guildId);

            if (allWeeks.length === 0) {
                return null;
            }

            const last12Weeks = allWeeks.slice(0, 12);

            // Zbierz dane gracza ze wszystkich tygodni i klanów (ostatnie 12 tygodni)
            const playerProgressData = [];

            for (const week of last12Weeks) {
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

            // Oblicz statystyki
            const stats = this.calculatePlayerStats(playerProgressData);

            return {
                userId,
                playerName: playerProgressData[0].displayName,
                recentWeeks: playerProgressData,
                stats
            };
        } catch (error) {
            logger.error(`Błąd pobierania danych gracza ${userId}: ${error.message}`);
            return null;
        }
    }

    /**
     * Oblicz statystyki gracza
     */
    calculatePlayerStats(weeks) {
        if (!weeks || weeks.length === 0) {
            return null;
        }

        const scores = weeks.map(w => w.score).filter(s => s > 0);
        if (scores.length === 0) return null;

        const latestScore = scores[0];
        const maxScore = Math.max(...scores);
        const minScore = Math.min(...scores);

        // Progres miesięczny (ostatnie 4 vs tydzień 5)
        let monthlyProgress = null;
        if (weeks.length >= 5) {
            const recentBest = Math.max(...weeks.slice(0, 4).map(w => w.score));
            const week5Score = weeks[4].score;
            if (week5Score > 0) {
                monthlyProgress = recentBest - week5Score;
            }
        }

        // Progres kwartalny (ostatnie 12 vs tydzień 13)
        let quarterlyProgress = null;
        if (weeks.length >= 13) {
            const recentBest = Math.max(...weeks.slice(0, 12).map(w => w.score));
            const week13Score = weeks[12].score;
            if (week13Score > 0) {
                quarterlyProgress = recentBest - week13Score;
            }
        }

        return {
            latestScore,
            maxScore,
            minScore,
            weeksWithData: scores.length,
            monthlyProgress,
            quarterlyProgress
        };
    }

    /**
     * Pobierz ranking klanu dla AI
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
        let prompt = `Jesteś asystentem AI dla bota StalkerLME, który zarządza statystykami graczy w grze Survivor.io.

ZASADY:
- Odpowiadaj ZAWSZE po polsku
- Bądź pomocny, ale też dowcipny gdy jest to stosowne
- Używaj emoji do urozmaicenia odpowiedzi
- Bądź konkretny - używaj TYLKO liczb i faktów które dostałeś poniżej
- KRYTYCZNE: NIE WYMYŚLAJ danych! Jeśli nie masz danych gracza - powiedz że nie znalazłeś jego wyników
- Gdy porównujesz graczy, bądź obiektywny ale możesz dodać zabawny komentarz
- Dane dotyczą wyników z Lunar Mine Expedition (bossy w grze Survivor.io)
- Wyniki to punkty zdobyte w bossach (liczby typu 1547, 2340 itd.)

KONTEKST PYTANIA:
Użytkownik: ${context.asker.displayName} (${context.asker.username})
${context.asker.clanName ? `Klan: ${context.asker.clanName}` : 'Klan: brak'}
Pytanie: ${context.question}
Typ pytania: ${context.queryType}
`;

        // Dodaj dane gracza którego dotyczy pytanie
        if (['stats', 'progress'].includes(context.queryType)) {
            // Jeśli wykryto nick w pytaniu - użyj targetPlayer, w przeciwnym razie pytającego
            const targetUserId = context.targetPlayer ? context.targetPlayer.id : context.asker.id;
            const targetName = context.targetPlayer ? context.targetPlayer.displayName : context.asker.displayName;

            const playerData = await this.getPlayerData(targetUserId, context.guild.id);
            if (playerData) {
                prompt += `\nDANE GRACZA (${playerData.playerName}):\n`;
                prompt += `Ostatni wynik: ${playerData.stats.latestScore} pkt\n`;
                prompt += `Najlepszy wynik: ${playerData.stats.maxScore} pkt\n`;
                if (playerData.stats.monthlyProgress !== null) {
                    prompt += `Progres miesięczny: ${playerData.stats.monthlyProgress > 0 ? '+' : ''}${playerData.stats.monthlyProgress} pkt\n`;
                }
                if (playerData.stats.quarterlyProgress !== null) {
                    prompt += `Progres kwartalny: ${playerData.stats.quarterlyProgress > 0 ? '+' : ''}${playerData.stats.quarterlyProgress} pkt\n`;
                }
                prompt += `Liczba tygodni z danymi: ${playerData.stats.weeksWithData}\n`;

                logger.info(`AI Chat: Pobrano dane dla ${playerData.playerName} - ${playerData.stats.weeksWithData} tygodni`);
            } else {
                prompt += `\nDANE GRACZA (${targetName}): Nie znaleziono żadnych wyników w bazie danych.\n`;
                logger.warn(`AI Chat: Brak danych dla userId ${targetUserId}`);
            }
        }

        // Dodaj dane dla porównania
        if (context.queryType === 'compare') {
            // Pierwszy gracz - targetPlayer lub pytający
            const firstUserId = context.targetPlayer ? context.targetPlayer.id : context.asker.id;
            const firstName = context.targetPlayer ? context.targetPlayer.displayName : context.asker.displayName;

            const firstData = await this.getPlayerData(firstUserId, context.guild.id);
            if (firstData) {
                prompt += `\nDANE PIERWSZEGO GRACZA (${firstData.playerName}):\n`;
                prompt += `Ostatni wynik: ${firstData.stats.latestScore} pkt\n`;
                prompt += `Najlepszy wynik: ${firstData.stats.maxScore} pkt\n`;
                if (firstData.stats.monthlyProgress !== null) {
                    prompt += `Progres miesięczny: ${firstData.stats.monthlyProgress > 0 ? '+' : ''}${firstData.stats.monthlyProgress} pkt\n`;
                }
                if (firstData.stats.quarterlyProgress !== null) {
                    prompt += `Progres kwartalny: ${firstData.stats.quarterlyProgress > 0 ? '+' : ''}${firstData.stats.quarterlyProgress} pkt\n`;
                }
                prompt += `Liczba tygodni z danymi: ${firstData.stats.weeksWithData}\n`;

                logger.info(`AI Chat: Pobrano dane dla ${firstData.playerName} - ${firstData.stats.weeksWithData} tygodni`);
            } else {
                prompt += `\nDANE PIERWSZEGO GRACZA (${firstName}): Nie znaleziono żadnych wyników w bazie danych.\n`;
                logger.warn(`AI Chat: Brak danych dla pierwszego gracza userId ${firstUserId}`);
            }

            // Drugi gracz - wspomniany użytkownik (jeśli jest)
            if (context.mentionedUser) {
                const secondData = await this.getPlayerData(context.mentionedUser.id, context.guild.id);
                if (secondData) {
                    prompt += `\nDANE DRUGIEGO GRACZA (${secondData.playerName}):\n`;
                    prompt += `Ostatni wynik: ${secondData.stats.latestScore} pkt\n`;
                    prompt += `Najlepszy wynik: ${secondData.stats.maxScore} pkt\n`;
                    if (secondData.stats.monthlyProgress !== null) {
                        prompt += `Progres miesięczny: ${secondData.stats.monthlyProgress > 0 ? '+' : ''}${secondData.stats.monthlyProgress} pkt\n`;
                    }
                    if (secondData.stats.quarterlyProgress !== null) {
                        prompt += `Progres kwartalny: ${secondData.stats.quarterlyProgress > 0 ? '+' : ''}${secondData.stats.quarterlyProgress} pkt\n`;
                    }
                    prompt += `Liczba tygodni z danymi: ${secondData.stats.weeksWithData}\n`;

                    logger.info(`AI Chat: Pobrano dane dla ${secondData.playerName} - ${secondData.stats.weeksWithData} tygodni`);
                } else {
                    prompt += `\nDANE DRUGIEGO GRACZA (${context.mentionedUser.displayName}): Nie znaleziono żadnych wyników w bazie danych.\n`;
                    logger.warn(`AI Chat: Brak danych dla drugiego gracza userId ${context.mentionedUser.id}`);
                }
            }
        }

        // Dodaj ranking klanu jeśli pytanie o ranking/klan
        if (['ranking', 'clan'].includes(context.queryType) && context.asker.clan) {
            const ranking = await this.getClanRanking(context.asker.clan, context.guild.id, 10);
            if (ranking.length > 0) {
                prompt += `\nRANKING KLANU ${context.asker.clanName} (TOP ${ranking.length}):\n`;
                ranking.forEach((player, idx) => {
                    prompt += `${idx + 1}. ${player.playerName} - ${player.score} pkt\n`;
                });
            }
        }

        prompt += `\nZADANIE: Odpowiedz na pytanie użytkownika w sposób pomocny i przyjazny. Używaj danych powyżej.`;
        prompt += `\nOdpowiedź powinna być zwięzła (max 1500 znaków) i sformatowana jako wiadomość Discord (obsługuje markdown).`;

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

        try {
            // Zbierz kontekst
            const context = await this.gatherContext(message, question);

            // Przygotuj prompt
            const prompt = await this.preparePrompt(context, message);

            // Wywołaj API
            const response = await this.client.messages.create({
                model: this.model,
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                temperature: 0.7
            });

            // Wyciągnij odpowiedź
            const answer = response.content[0].text;

            // Log usage (opcjonalnie)
            logger.info(`AI Chat: ${context.asker.username} zadał pytanie (typ: ${context.queryType})`);

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
