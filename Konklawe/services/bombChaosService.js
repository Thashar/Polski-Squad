const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

const CHAOS_FILE = path.join(__dirname, '../../shared_data/bomb_chaos_state.json');
const EXEMPT_ROLE_ID = '1486506395057524887';
const CHAOS_DURATION_MS = 60 * 60 * 1000; // 1 godzina
const CURSE_CHANCE = 0.3; // 30%
const GHOST_DELETE_DELAY_MS = 2000;

class BombChaosService {
    constructor() {
        this.expiresAt = 0;
        this._loadState();
    }

    _loadState() {
        try {
            const raw = fs.readFileSync(CHAOS_FILE, 'utf8');
            const saved = JSON.parse(raw);
            if (saved.active && saved.expiresAt) {
                this.expiresAt = saved.expiresAt;
                const remaining = Math.max(0, saved.expiresAt - Date.now());
                if (remaining > 0) {
                    logger.info(`✅ BombChaos: chaos aktywny, wygasa za ${Math.round(remaining / 60000)} min`);
                }
            }
        } catch {
            // brak pliku = chaos nieaktywny
        }
    }

    isActive() {
        return Date.now() < this.expiresAt;
    }

    activate() {
        this.expiresAt = Date.now() + CHAOS_DURATION_MS;
        try {
            fs.writeFileSync(CHAOS_FILE, JSON.stringify({ active: true, expiresAt: this.expiresAt }));
        } catch (err) {
            logger.error('❌ BombChaos: błąd zapisu stanu:', err.message);
        }
        logger.info('💣 BombChaos: chaos bomby aktywowany na 1 godzinę');
    }

    async handleMessage(message) {
        if (!this.isActive()) return;
        if (message.author.bot) return;
        if (!message.member) return;

        // Pomiń osoby z rolą gracza
        if (message.member.roles.cache.has(EXEMPT_ROLE_ID)) return;

        // 30% szansa
        if (Math.random() >= CURSE_CHANCE) return;

        try {
            const ghostMsg = await message.channel.send(`💥 <@${message.author.id}> 💥`);
            setTimeout(() => ghostMsg.delete().catch(() => {}), GHOST_DELETE_DELAY_MS);
        } catch (err) {
            logger.error('❌ BombChaos: błąd ghost pinga:', err.message);
        }
    }
}

module.exports = BombChaosService;
