const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Muteusz');

const PLAYER_ROLE_ID = '1486506395057524887';

// Kanały do odblokowania po rozwiązaniu zagadki o danym indeksie (0–4)
const UNLOCK_ON_SOLVE = [
    ['1486582161627680789'],                           // 0: Nimfa → Przyciski
    ['1486582235816530113'],                           // 1: Przyciski → EMPTY
    ['1486582292964184206'],                           // 2: EMPTY → Kucharek
    ['1486582331278889040', '1486848827997818900'],    // 3: Kucharek → Gorący kartofel
    [],                                               // 4: Gorący kartofel → koniec
];

const PUZZLE_NAMES = ['Nimfa', 'Przyciski', 'EMPTY', 'Kucharek', 'Gorący kartofel'];

class PuzzleChainService {
    constructor() {
        this.client = null;
    }

    initialize(client) {
        this.client = client;
        logger.info('✅ PuzzleChain: zainicjalizowano');
    }

    async onPuzzleSolved(puzzleIndex) {
        const channelsToUnlock = UNLOCK_ON_SOLVE[puzzleIndex];
        if (!channelsToUnlock || channelsToUnlock.length === 0) {
            logger.info(`🏁 PuzzleChain: ${PUZZLE_NAMES[puzzleIndex]} - ostatnia zagadka, koniec łańcucha`);
            return;
        }

        logger.info(`🔗 PuzzleChain: ${PUZZLE_NAMES[puzzleIndex]} rozwiązana → odblokowuję ${channelsToUnlock.length} kanał(y)`);

        for (const channelId of channelsToUnlock) {
            try {
                const channel = await this.client.channels.fetch(channelId);
                await channel.permissionOverwrites.create(PLAYER_ROLE_ID, {}, { reason: `PuzzleChain: odblokowanie po rozwiązaniu zagadki ${PUZZLE_NAMES[puzzleIndex]}` });
                logger.success(`🔓 PuzzleChain: dodano rolę do uprawnień kanału ${channelId} (wszystko na /)`);
            } catch (err) {
                logger.error(`❌ PuzzleChain: błąd odblokowania kanału ${channelId}: ${err.message}`);
            }
        }
    }
}

module.exports = PuzzleChainService;
