const fs = require('fs');
const path = require('path');

const SHARED_COMBAT_FILE = path.join(__dirname, '../../shared_data/player_combat_history.json');
const LOCAL_COMBAT_FILE = path.join(__dirname, '../data/player_combat_discord.json');

/**
 * Serwis do ingestowania danych graczy z Gary bota do lokalnej bazy Stalkera.
 *
 * Przepływ:
 * 1. Gary co tydzień zapisuje dane graczy (RC+TC, atak) do shared_data/player_combat_history.json
 *    z kluczem = nick w grze (lowercase).
 * 2. Ten serwis (uruchamiany w środę o 18:55 i przy starcie) czyta te dane,
 *    dopasowuje fuzzy nicki do członków Discorda z ról klanowych,
 *    i zapisuje do Stalker/data/player_combat_discord.json z kluczem = userId Discord.
 * 3. Komendy /player-status i /player-compare czytają z lokalnej bazy po userId.
 */
class GaryCombatIngestionService {
    constructor(client, config, databaseService, logger) {
        this.client = client;
        this.config = config;
        this.databaseService = databaseService;
        this.logger = logger;
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

        // Jeden zawiera drugi (min 3 znaki)
        if (s1.length >= 3 && s2.length >= 3) {
            if (s1.includes(s2) || s2.includes(s1)) return 1.0;
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

        for (const [userId, { displayName }] of clanMembers) {
            const knownNicks = [displayName, ...(playerIndex[userId]?.allNicks || [])];
            for (const nick of knownNicks) {
                const score = this._calcSimilarity(inGameName, nick);
                if (score > bestScore) {
                    bestScore  = score;
                    bestUserId = userId;
                }
            }
        }

        return { userId: bestUserId, score: bestScore };
    }

    /**
     * Główna metoda ingestion — czyta dane z Gary, mapuje nicki na userId Discord,
     * upsertuje tygodniowe wpisy do lokalnego player_combat_discord.json.
     */
    async ingest() {
        try {
            if (!fs.existsSync(SHARED_COMBAT_FILE)) {
                this.logger.info('📊 GaryCombatIngestion: brak danych Gary (shared_data/player_combat_history.json)');
                return { matched: 0, total: 0 };
            }

            const garyData = JSON.parse(fs.readFileSync(SHARED_COMBAT_FILE, 'utf8'));
            if (!garyData?.players) return { matched: 0, total: 0 };

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

            for (const guild of this.client.guilds.cache.values()) {
                const clanMembers = await this._getAllClanMembers(guild);
                if (clanMembers.size === 0) continue;

                const playerIndex = await this.databaseService.loadPlayerIndex(guild.id);

                for (const inGameName of playerNames) {
                    const { userId } = this._findBestMatch(inGameName, clanMembers, playerIndex);
                    if (!userId) continue;

                    const garyWeeks = garyData.players[inGameName].weeks || [];
                    if (garyWeeks.length === 0) continue;

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

            localData.lastUpdated = new Date().toISOString();

            const dir = path.dirname(LOCAL_COMBAT_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(LOCAL_COMBAT_FILE, JSON.stringify(localData, null, 2), 'utf8');

            this.logger.info(
                `📊 GaryCombatIngestion: dopasowano ${totalMatched}/${playerNames.length} graczy ` +
                `do kont Discord`
            );
            return { matched: totalMatched, total: playerNames.length };
        } catch (err) {
            this.logger.error('GaryCombatIngestion: błąd ingestion:', err.message);
            return { matched: 0, total: 0 };
        }
    }
}

module.exports = GaryCombatIngestionService;
