const fs = require('fs').promises;
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Stalker');
const SHARED_DATA_PATH = path.join(__dirname, '../../shared_data/glory_progress.json');

// Minimalny progres (względem rekordu) uprawniający do 1 losu w loterii Glory
const MIN_PROGRESS_FOR_TICKET = 5;

/**
 * Eksportuje dane progresu Fazy 1 potrzebne do loterii Glory (Kontroler).
 *
 * Progres liczony IDENTYCZNIE jak w komendzie /progres:
 *   progres(tydzień) = wynik(tydzień) − najlepszy wynik z WCZEŚNIEJSZYCH tygodni gracza (rekord).
 * Liczy się tylko, gdy istnieje wcześniejszy rekord > 0 (nowi gracze nie "progresują").
 *
 * Dla każdego klanu (0/1/2/main) zapisuje listę uczestników ostatniego tygodnia
 * z przypisaną liczbą losów (1/2/3) wg progów:
 *   - progres ≥ MIN_PROGRESS_FOR_TICKET (5)            → 1 los
 *   - progres ≥ średnia progresu progresujących (poprz. tydzień) → 2 losy
 *   - progres ≥ 2 × ta średnia                          → 3 losy
 * Gdy brak danych wcześniejszego tygodnia / brak progresujących → każdy kwalifikujący dostaje 1 los.
 *
 * Zapisywane do shared_data/glory_progress.json, czytane przez Kontroler (gloryLotteryService).
 *
 * @param {Guild} guild - Serwer Discord
 * @param {Object} databaseService - Serwis bazy danych Stalkera
 * @param {Object} config - Konfiguracja Stalkera (config.targetRoles)
 */
async function exportGloryProgress(guild, databaseService, config) {
    try {
        const allWeeks = await databaseService.getAvailableWeeks(guild.id);
        if (allWeeks.length === 0) {
            logger.info('[GLORY] Brak tygodni z danymi — pomijam eksport progresu Glory');
            return;
        }

        // Zbierz pełną historię wyników per userId (wszystkie tygodnie/klany) do liczenia rekordu.
        // userHistory: userId → [{ weekNumber, year, score }]
        const userHistory = new Map();
        // weekClanPlayers: `${weekNumber}-${year}-${clan}` → [{ userId, displayName, score }]
        const weekClanPlayers = new Map();

        for (const week of allWeeks) {
            for (const clan of week.clans) {
                const weekData = await databaseService.getPhase1Results(
                    guild.id, week.weekNumber, week.year, clan
                );
                if (!weekData?.players) continue;

                weekClanPlayers.set(`${week.weekNumber}-${week.year}-${clan}`, weekData.players);

                for (const player of weekData.players) {
                    if (!player.userId) continue;
                    if (!userHistory.has(player.userId)) userHistory.set(player.userId, []);
                    userHistory.get(player.userId).push({
                        weekNumber: week.weekNumber,
                        year: week.year,
                        score: player.score
                    });
                }
            }
        }

        // Rekord gracza z tygodni ŚCIŚLE wcześniejszych niż (targetWeek, targetYear)
        const recordBefore = (userId, targetWeek, targetYear) => {
            const hist = userHistory.get(userId);
            if (!hist) return 0;
            let best = 0;
            for (const e of hist) {
                const isBefore = e.year < targetYear ||
                    (e.year === targetYear && e.weekNumber < targetWeek);
                if (isBefore && e.score > best) best = e.score;
            }
            return best;
        };

        // Progres gracza względem rekordu w danym tygodniu (null gdy brak wcześniejszego rekordu)
        const progressInWeek = (userId, score, weekNumber, year) => {
            const rec = recordBefore(userId, weekNumber, year);
            if (rec <= 0) return null; // nowy gracz — nie "progresuje"
            return score - rec;
        };

        const clanKeys = Object.keys(config.targetRoles); // '0','1','2','main'
        const exportClans = {};

        for (const clan of clanKeys) {
            // Tygodnie, w których ten klan ma dane (allWeeks jest już malejąco)
            const clanWeeks = allWeeks.filter(w => w.clans.includes(clan));
            if (clanWeeks.length === 0) {
                exportClans[clan] = { lastWeek: null, previousWeek: null, averageProgress: null, participants: [] };
                continue;
            }

            const lastWeek = clanWeeks[0];
            const prevWeek = clanWeeks[1] || null;

            // Średnia progresu progresujących w poprzednim tygodniu (baseline)
            let averageProgress = null;
            if (prevWeek) {
                const prevPlayers = weekClanPlayers.get(`${prevWeek.weekNumber}-${prevWeek.year}-${clan}`) || [];
                const prevProgresses = [];
                for (const p of prevPlayers) {
                    const prog = progressInWeek(p.userId, p.score, prevWeek.weekNumber, prevWeek.year);
                    if (prog !== null && prog > 0) prevProgresses.push(prog);
                }
                if (prevProgresses.length > 0) {
                    averageProgress = prevProgresses.reduce((a, b) => a + b, 0) / prevProgresses.length;
                }
            }

            // Uczestnicy ostatniego tygodnia z liczbą losów
            const lastPlayers = weekClanPlayers.get(`${lastWeek.weekNumber}-${lastWeek.year}-${clan}`) || [];
            const participants = [];
            for (const p of lastPlayers) {
                const prog = progressInWeek(p.userId, p.score, lastWeek.weekNumber, lastWeek.year);
                if (prog === null || prog < MIN_PROGRESS_FOR_TICKET) continue;

                let tickets = 1;
                if (averageProgress && averageProgress > 0) {
                    if (prog >= 2 * averageProgress) tickets = 3;
                    else if (prog >= averageProgress) tickets = 2;
                }
                participants.push({
                    userId: p.userId,
                    displayName: p.displayName,
                    progress: prog,
                    tickets
                });
            }

            exportClans[clan] = {
                lastWeek: { weekNumber: lastWeek.weekNumber, year: lastWeek.year },
                previousWeek: prevWeek ? { weekNumber: prevWeek.weekNumber, year: prevWeek.year } : null,
                averageProgress: averageProgress !== null ? Math.round(averageProgress * 100) / 100 : null,
                participants
            };
        }

        // Zachowaj dane innych gildii (jeśli plik istnieje)
        let existing = {};
        try {
            const raw = await fs.readFile(SHARED_DATA_PATH, 'utf8');
            existing = JSON.parse(raw);
        } catch { /* plik nie istnieje — zaczynamy od zera */ }

        existing[guild.id] = { updatedAt: new Date().toISOString(), clans: exportClans };

        await fs.writeFile(SHARED_DATA_PATH, JSON.stringify(existing, null, 2), 'utf8');

        const summary = clanKeys
            .map(c => `${c}:${exportClans[c]?.participants.length || 0}`)
            .join(', ');
        logger.info(`[GLORY] ✅ Eksport progresu Glory zaktualizowany (uczestnicy per klan: ${summary})`);

    } catch (err) {
        logger.error('[GLORY] ❌ Błąd eksportu progresu Glory:', err.message);
    }
}

module.exports = { exportGloryProgress };
