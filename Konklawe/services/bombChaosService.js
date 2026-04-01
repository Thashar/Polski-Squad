const fs = require('fs');
const path = require('path');
const { createBotLogger } = require('../../utils/consoleLogger');

const logger = createBotLogger('Konklawe');

const CHAOS_FILE = path.join(__dirname, '../../shared_data/bomb_chaos_state.json');
const EXEMPT_ROLE_ID = '1486506395057524887';
const CHAOS_DURATION_MS = 60 * 60 * 1000;  // 1 godzina aktywności zarażania
const INFECTION_DURATION_MS = 5 * 60 * 1000; // 5 minut pingu po zarażeniu
const INFECTION_INTERVAL_MS = 30 * 1000;     // ping co 30 sekund
const CURSE_CHANCE = 0.3;                    // 30% szansa zarażenia
const GHOST_DELETE_DELAY_MS = 2000;

class BombChaosService {
    constructor() {
        this.expiresAt = 0;
        // userId → { channelId, expiresAt, intervalId, client }
        this.infected = new Map();
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

    _infectUser(userId, channel) {
        // Anuluj poprzednie zarażenie jeśli istnieje
        this._clearInfection(userId);

        const expiresAt = Date.now() + INFECTION_DURATION_MS;

        const intervalId = setInterval(async () => {
            if (Date.now() >= expiresAt) {
                this._clearInfection(userId);
                return;
            }
            try {
                const msg = await channel.send(`💥 <@${userId}> 💥`);
                setTimeout(() => msg.delete().catch(() => {}), GHOST_DELETE_DELAY_MS);
            } catch {
                this._clearInfection(userId);
            }
        }, INFECTION_INTERVAL_MS);

        this.infected.set(userId, { channelId: channel.id, expiresAt, intervalId });
        logger.info(`☣️ BombChaos: zarażono ${userId} na 5 minut`);
    }

    _clearInfection(userId) {
        const entry = this.infected.get(userId);
        if (entry) {
            clearInterval(entry.intervalId);
            this.infected.delete(userId);
        }
    }

    async handleMessage(message) {
        if (message.author.bot) return;
        if (!message.member) return;
        if (message.member.roles.cache.has(EXEMPT_ROLE_ID)) return;
        if (message.member.permissions.has(0x8n)) return; // Administrator

        const userId = message.author.id;

        // Jeśli użytkownik jest zarażony — zaktualizuj kanał (żeby pingi szły tam gdzie piszą)
        if (this.infected.has(userId)) {
            const entry = this.infected.get(userId);
            entry.channelId = message.channel.id;
            // Odśwież interwał z nowym kanałem
            clearInterval(entry.intervalId);
            entry.intervalId = setInterval(async () => {
                if (Date.now() >= entry.expiresAt) {
                    this._clearInfection(userId);
                    return;
                }
                try {
                    const msg = await message.channel.send(`💥 <@${userId}> 💥`);
                    setTimeout(() => msg.delete().catch(() => {}), GHOST_DELETE_DELAY_MS);
                } catch {
                    this._clearInfection(userId);
                }
            }, INFECTION_INTERVAL_MS);
            return;
        }

        // Nowe zarażenie — tylko gdy chaos aktywny i 30% szansa
        if (!this.isActive()) return;
        if (Math.random() >= CURSE_CHANCE) return;

        this._infectUser(userId, message.channel);
    }
}

module.exports = BombChaosService;
