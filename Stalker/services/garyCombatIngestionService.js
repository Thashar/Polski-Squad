const fs = require('fs');
const path = require('path');
const { safeFetchMembers } = require('../../utils/guildMembersThrottle');
const { isoWeekStartUTC } = require('../../utils/appSync');

const WEEKLY_DIR      = path.join(__dirname, '../../shared_data/lme_weekly');
const LOCAL_COMBAT_FILE = path.join(__dirname, '../data/player_combat_discord.json');

/**
 * Serwis do ingestowania danych graczy z Gary bota do lokalnej bazy Stalkera.
 *
 * Przepływ:
 * 1. Gary co tydzień zapisuje dane graczy (RC+TC, atak) do shared_data/lme_weekly/week_YYYY_WW.json
 *    z kluczem = nick w grze (lowercase). Każdy tydzień to osobny plik.
 * 2. Ten serwis (uruchamiany w środę o 18:55 i przy starcie) agreguje wszystkie pliki weekly,
 *    dopasowuje fuzzy nicki do członków Discorda z ról klanowych,
 *    i zapisuje do Stalker/data/player_combat_discord.json z kluczem = userId Discord.
 * 3. Komendy /player-status i /player-compare czytają z lokalnej bazy po userId.
 */
class GaryCombatIngestionService {
    constructor(client, config, databaseService, logger, appSync) {
        this.client = client;
        this.config = config;
        this.databaseService = databaseService;
        this.logger = logger;
        this.appSync = appSync;
    }

    /** Usuwa prefiks klanowy z nicku z gry (np. "PLㅣPuddi" → "Puddi", "PL|Pushok" → "Pushok") */
    _stripClanPrefix(name) {
        return name.replace(/^[A-Za-z]{1,5}[ㅣ|]\s*/u, '');
    }

    /** Normalizacja nazwy: lowercase, tylko znaki alfanumeryczne + polskie */
    _normalize(name) {
        return name.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]/g, '');
    }

    /** Oblicza podobieństwo między dwoma nazwami graczy (0.0 - 1.0) */
    _calcSimilarity(a, b) {
        const s1 = this._normalize(a);
        const s2 = this._normalize(b);
        if (!s1 || !s2) return 0;
        if (s1 === s2) return 1.0;

        // Jeden zawiera drugi (min 3 znaki) — 0.99 a nie 1.0, żeby exact match zawsze wygrał
        if (s1.length >= 3 && s2.length >= 3) {
            if (s1.includes(s2) || s2.includes(s1)) return 0.99;
        }

        // Fuzzy match dla nicków 5+ znaków (tolerancja 1-2 błędy OCR)
        if (s1.length >= 5 && s2.length >= 5) {
            const shorter = s1.length <= s2.length ? s1 : s2;
            const longer  = s1.length <= s2.length ? s2 : s1;
            for (let i = 0; i <= longer.length - shorter.length; i++) {
                const sub = longer.substring(i, i + shorter.length);
                let diff = 0;
                for (let j = 0; j < shorter.length; j++) {
                    if (sub[j] !== shorter[j]) diff++;
                }
                const maxDiff = shorter.length >= 8 ? 2 : 1;
                if (diff <= maxDiff) return 1 - (diff / shorter.length);
            }
        }

        return this._orderedSimilarity(s1, s2);
    }

    /** Podobieństwo oparte na kolejności znaków (fallback) */
    _orderedSimilarity(s1, s2) {
        if (!s1.length || !s2.length) return 0;
        const shorter = s1.length <= s2.length ? s1 : s2;
        const longer  = s1.length <= s2.length ? s2 : s1;
        let matched = 0, pos = 0;
        for (const ch of shorter) {
            for (let i = pos; i < longer.length; i++) {
                if (longer[i] === ch) { matched++; pos = i + 1; break; }
            }
        }
        const base = matched / shorter.length;
        const lenDiff = Math.abs(s1.length - s2.length);
        const maxLen  = Math.max(s1.length, s2.length);
        return Math.max(0, base / (1 + (maxLen > 0 ? lenDiff / maxLen : 0)));
    }

    /** Zwraca mapę userId → { member, displayName } dla wszystkich 4 ról klanowych */
    async _getAllClanMembers(guild) {
        const members = new Map();
        const roleIds = Object.values(this.config.targetRoles).filter(Boolean);
        for (const roleId of roleIds) {
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;
            for (const [userId, member] of role.members) {
                if (!members.has(userId)) {
                    members.set(userId, { member, displayName: member.displayName });
                }
            }
        }
        return members;
    }

    /** Szuka najlepszego dopasowania Discord userId dla podanego nicku z gry */
    _findBestMatch(inGameName, clanMembers, playerIndex) {
        const THRESHOLD = 0.82;
        let bestUserId = null;
        let bestScore  = THRESHOLD;
        // Tie-break: dopasowanie przez aktualny displayName bije stary nick z playerIndex
        let bestFromDisplayName = false;

        // Dla raportu: absolutne najlepsze dopasowanie (nawet poniżej progu)
        let closestScore = 0;
        let closestDiscordName = null;

        // Usuń prefiks klanowy przed matching (np. "PLㅣPuddi" → "Puddi")
        const nameForMatching = this._stripClanPrefix(inGameName);

        for (const [userId, { displayName }] of clanMembers) {
            const knownNicks = [displayName, ...(playerIndex[userId]?.allNicks || [])];
            for (let i = 0; i < knownNicks.length; i++) {
                const score = this._calcSimilarity(nameForMatching, knownNicks[i]);
                const fromDisplayName = (i === 0);
                // Wygrywa wyższy score; przy remisie displayName bije stary nick z allNicks
                if (score > bestScore || (score === bestScore && fromDisplayName && !bestFromDisplayName)) {
                    bestScore           = score;
                    bestUserId          = userId;
                    bestFromDisplayName = fromDisplayName;
                }
                if (score > closestScore) {
                    closestScore       = score;
                    closestDiscordName = displayName;
                }
            }
        }

        return { userId: bestUserId, score: bestScore, closestScore, closestDiscordName };
    }

    /**
     * Główna metoda ingestion — czyta dane z Gary, mapuje nicki na userId Discord,
     * upsertuje tygodniowe wpisy do lokalnego player_combat_discord.json.
     * Zwraca rozszerzony raport: nieprzypisane wpisy Gary + klanowcy bez danych.
     */
    async ingest() {
        try {
            // Agreguj dane ze wszystkich plików weekly (shared_data/lme_weekly/week_YYYY_WW.json)
            if (!fs.existsSync(WEEKLY_DIR)) {
                this.logger.info('📊 GaryCombatIngestion: brak katalogu shared_data/lme_weekly — uruchom /lme-snapshot w Gary');
                return { matched: 0, total: 0, unmatchedGary: [], clanMembersWithoutData: [] };
            }

            const weekFiles = fs.readdirSync(WEEKLY_DIR)
                .filter(f => f.startsWith('week_') && f.endsWith('.json'))
                .sort(); // week_YYYY_WW — sortowanie leksykograficzne = chronologiczne

            if (weekFiles.length === 0) {
                this.logger.info('📊 GaryCombatIngestion: brak plików weekly — uruchom /lme-snapshot w Gary');
                return { matched: 0, total: 0, unmatchedGary: [], clanMembersWithoutData: [] };
            }

            // Zbuduj strukturę garyData agregując wszystkie tygodnie
            const garyData = { players: {} };
            for (const file of weekFiles) {
                let weekData;
                try {
                    weekData = JSON.parse(fs.readFileSync(path.join(WEEKLY_DIR, file), 'utf8'));
                } catch (_) {
                    this.logger.warn(`GaryCombatIngestion: pominięto uszkodzony plik ${file}`);
                    continue;
                }
                if (!weekData?.players || !weekData.weekNumber || !weekData.year) continue;

                for (const [key, player] of Object.entries(weekData.players)) {
                    if (!garyData.players[key]) {
                        garyData.players[key] = { originalName: player.originalName || key, weeks: [] };
                    }
                    garyData.players[key].originalName = player.originalName || key;
                    // Upsert tygodnia (plik per-tydzień zawiera już dokładnie jeden wpis per gracz)
                    const existingIdx = garyData.players[key].weeks.findIndex(
                        w => w.weekNumber === weekData.weekNumber && w.year === weekData.year
                    );
                    const entry = {
                        weekNumber: weekData.weekNumber,
                        year:       weekData.year,
                        attack:     player.attack      || 0,
                        relicCores: player.relicCores  || 0
                    };
                    if (existingIdx >= 0) {
                        garyData.players[key].weeks[existingIdx] = entry;
                    } else {
                        garyData.players[key].weeks.push(entry);
                    }
                }
            }

            if (!garyData.players || Object.keys(garyData.players).length === 0) {
                return { matched: 0, total: 0, unmatchedGary: [], clanMembersWithoutData: [] };
            }

            this.logger.info(`📊 GaryCombatIngestion: zaagregowano ${weekFiles.length} plików weekly`);

            // Wczytaj istniejące dane lokalne lub zacznij od zera
            let localData = { players: {}, lastUpdated: '' };
            if (fs.existsSync(LOCAL_COMBAT_FILE)) {
                try {
                    localData = JSON.parse(fs.readFileSync(LOCAL_COMBAT_FILE, 'utf8'));
                    if (!localData.players) localData.players = {};
                } catch (_) {
                    localData = { players: {} };
                }
            }

            const playerNames = Object.keys(garyData.players);
            let totalMatched = 0;
            const matchedPlayerNames = new Set();   // Nicki Gary które zostały dopasowane
            const matchedUserIds     = new Set();   // Discord userId które otrzymały dane
            const allClanMembers     = new Map();   // Agregat: userId → { displayName } ze wszystkich gildii
            // inGameName → { userId, discordName } — kto dostał każdy wpis Gary (do raportu)
            const garyAssignments    = new Map();

            // Wpisy Gary bez dopasowania: inGameName → { reason, closestDiscordName, closestScore }
            const garyUnmatched = new Map();

            for (const guild of this.client.guilds.cache.values()) {
                // Pobierz wszystkich członków serwera — bez tego role.members zawiera tylko cache
                await safeFetchMembers(guild, this.logger);

                const clanMembers = await this._getAllClanMembers(guild);
                if (clanMembers.size === 0) continue;

                // Akumuluj wszystkich klanowców ze wszystkich gildii
                for (const [uid, data] of clanMembers) {
                    if (!allClanMembers.has(uid)) allClanMembers.set(uid, data);
                }

                const playerIndex = await this.databaseService.loadPlayerIndex(guild.id);

                for (const inGameName of playerNames) {
                    if (matchedPlayerNames.has(inGameName)) continue; // już dopasowany

                    const { userId, closestScore, closestDiscordName } =
                        this._findBestMatch(inGameName, clanMembers, playerIndex);
                    const garyWeeks = garyData.players[inGameName].weeks || [];

                    if (!userId || garyWeeks.length === 0) {
                        const reason = garyWeeks.length === 0
                            ? 'brak_danych_tygodniowych'
                            : 'zbyt_niskie_podobienstwo';
                        if (!garyUnmatched.has(inGameName)) {
                            garyUnmatched.set(inGameName, {
                                reason,
                                closestDiscordName: closestDiscordName || null,
                                closestScore: closestScore > 0 ? Math.round(closestScore * 100) : null
                            });
                        }
                        continue;
                    }

                    // Dopasowanie znalezione — upsert danych tygodniowych
                    matchedPlayerNames.add(inGameName);
                    matchedUserIds.add(userId);
                    garyAssignments.set(inGameName, {
                        userId,
                        discordName: clanMembers.get(userId)?.displayName || inGameName
                    });
                    garyUnmatched.delete(inGameName); // usuń z nieprzypisanych jeśli był tam wcześniej

                    if (!localData.players[userId]) {
                        localData.players[userId] = {
                            discordName: clanMembers.get(userId)?.displayName || inGameName,
                            weeks: []
                        };
                    }

                    // Upsert tygodniowych wpisów
                    for (const week of garyWeeks) {
                        const existingIdx = localData.players[userId].weeks.findIndex(
                            w => w.weekNumber === week.weekNumber && w.year === week.year
                        );
                        if (existingIdx >= 0) {
                            localData.players[userId].weeks[existingIdx] = week;
                        } else {
                            localData.players[userId].weeks.push(week);
                        }
                    }

                    // Sortuj chronologicznie; nie obcinaj historii
                    localData.players[userId].weeks.sort((a, b) =>
                        a.year !== b.year ? a.year - b.year : a.weekNumber - b.weekNumber
                    );

                    // Zaktualizuj displayName do aktualnej nazwy Discord
                    localData.players[userId].discordName =
                        clanMembers.get(userId)?.displayName || inGameName;

                    totalMatched++;
                }
            }

            // Wpisy Gary które nie były przetworzone przez żadną gildię (brak ról klanowych)
            for (const inGameName of playerNames) {
                if (!matchedPlayerNames.has(inGameName) && !garyUnmatched.has(inGameName)) {
                    const garyWeeks = garyData.players[inGameName].weeks || [];
                    garyUnmatched.set(inGameName, {
                        reason: garyWeeks.length === 0 ? 'brak_danych_tygodniowych' : 'brak_rol_klanowych',
                        closestDiscordName: null,
                        closestScore: null
                    });
                }
            }

            localData.lastUpdated = new Date().toISOString();

            const dir = path.dirname(LOCAL_COMBAT_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(LOCAL_COMBAT_FILE, JSON.stringify(localData, null, 2), 'utf8');

            // Po zapisie lokalnej bazy, mirroruj wszystkie (gracz × tydzień) do web API.
            // Endpoint jest idempotentny (natural key: discordId+year+weekNumber),
            // więc bezpiecznie wypychamy całą historię przy każdym ingestion.
            for (const [userId, info] of Object.entries(localData.players || {})) {
                for (const week of info.weeks || []) {
                    if (!week.weekNumber || !week.year) continue;
                    this.appSync.combatWeekly({
                        discordId: userId,
                        year: week.year,
                        weekNumber: week.weekNumber,
                        weekStartsAt: isoWeekStartUTC(week.year, week.weekNumber),
                        rc: week.relicCores || 0,
                        tc: week.transmuteCores || 0, // Gary obecnie nie dostarcza TC — zarezerwowane
                        attack: String(week.attack || 0),
                    });
                }
            }

            // Klanowcy którzy NIE otrzymali danych w tej ingestion
            const clanMembersWithoutData = [];
            for (const [userId, { displayName }] of allClanMembers) {
                if (!matchedUserIds.has(userId)) {
                    // Odwrotne wyszukiwanie: znajdź najbliższy wpis Gary dla tego klanowca
                    let closestGaryName = null;
                    let closestGaryScore = 0;
                    let closestGaryKey = null;
                    for (const inGameName of playerNames) {
                        const score = this._calcSimilarity(displayName, this._stripClanPrefix(inGameName));
                        if (score > closestGaryScore) {
                            closestGaryScore = score;
                            closestGaryName  = garyData.players[inGameName].originalName || inGameName;
                            closestGaryKey   = inGameName;
                        }
                    }
                    // Kto dostał ten wpis Gary zamiast tego klanowca?
                    const stolen = closestGaryKey ? garyAssignments.get(closestGaryKey) : null;
                    clanMembersWithoutData.push({
                        userId,
                        discordName: displayName,
                        closestGaryName:  closestGaryScore > 0 ? closestGaryName : null,
                        closestGaryScore: closestGaryScore > 0 ? Math.round(closestGaryScore * 100) : null,
                        stolenByUserId:   stolen?.userId   || null,
                        stolenByName:     stolen?.discordName || null
                    });
                }
            }

            this.logger.info(
                `📊 GaryCombatIngestion: dopasowano ${totalMatched}/${playerNames.length} graczy ` +
                `do kont Discord`
            );

            return {
                matched:               totalMatched,
                total:                 playerNames.length,
                unmatchedGary:         [...garyUnmatched.entries()].map(([name, info]) => ({ inGameName: name, ...info })),
                clanMembersWithoutData
            };
        } catch (err) {
            this.logger.error('GaryCombatIngestion: błąd ingestion:', err.message);
            return { matched: 0, total: 0, unmatchedGary: [], clanMembersWithoutData: [] };
        }
    }
}

module.exports = GaryCombatIngestionService;
