const fs = require('fs').promises;
const path = require('path');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minut

class UpdateCooldownService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'update_cooldowns.json');
        this._cooldowns = new Map(); // userId -> expiresAt (timestamp ms)
        this._cooldownDurationMs = DEFAULT_COOLDOWN_MS;
    }

    async load() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            const now = Date.now();
            if (typeof data.cooldownDurationMs === 'number') {
                // Nowy format: { cooldownDurationMs, cooldowns: {userId: expiresAt} }
                this._cooldownDurationMs = data.cooldownDurationMs;
                for (const [userId, expiresAt] of Object.entries(data.cooldowns || {})) {
                    if (expiresAt > now) this._cooldowns.set(userId, expiresAt);
                }
            } else {
                // Stary format: { userId: expiresAt } — migracja
                this._cooldownDurationMs = DEFAULT_COOLDOWN_MS;
                for (const [userId, expiresAt] of Object.entries(data)) {
                    if (typeof expiresAt === 'number' && expiresAt > now) {
                        this._cooldowns.set(userId, expiresAt);
                    }
                }
            }
        } catch {
            // Plik nie istnieje — zaczynamy od zera
        }
    }

    async save() {
        const now = Date.now();
        const cooldowns = {};
        for (const [userId, expiresAt] of this._cooldowns) {
            if (expiresAt > now) cooldowns[userId] = expiresAt;
        }
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify({
            cooldownDurationMs: this._cooldownDurationMs,
            cooldowns
        }, null, 2), 'utf8');
    }

    // Zwraca pozostały czas w ms, lub null jeśli brak cooldownu
    getRemainingMs(userId) {
        const expiresAt = this._cooldowns.get(userId);
        if (!expiresAt) return null;
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            this._cooldowns.delete(userId);
            return null;
        }
        return remaining;
    }

    async setCooldown(userId) {
        this._cooldowns.set(userId, Date.now() + this._cooldownDurationMs);
        await this.save().catch(() => {});
    }

    getCooldownDuration() {
        return this._cooldownDurationMs;
    }

    async setCooldownDuration(ms) {
        this._cooldownDurationMs = (ms !== null && ms > 0) ? ms : DEFAULT_COOLDOWN_MS;
        await this.save().catch(() => {});
    }
}

function formatCooldownTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0 && seconds > 0) return `${minutes} min ${seconds} s`;
    if (minutes > 0) return `${minutes} min`;
    return `${seconds} s`;
}

// Formatuje ms na czytelny string, np. "5m", "1h", "1h 30m"
function formatCooldownDuration(ms) {
    if (!ms) return '—';
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
}

module.exports = { UpdateCooldownService, formatCooldownTime, formatCooldownDuration };
