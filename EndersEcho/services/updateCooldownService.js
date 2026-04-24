const fs = require('fs').promises;
const path = require('path');

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minut

class UpdateCooldownService {
    constructor(config) {
        this.filePath = path.join(config.ranking.dataDir, 'update_cooldowns.json');
        this._cooldowns = new Map(); // userId -> expiresAt (timestamp ms)
    }

    async load() {
        try {
            const raw = await fs.readFile(this.filePath, 'utf8');
            const data = JSON.parse(raw);
            const now = Date.now();
            for (const [userId, expiresAt] of Object.entries(data)) {
                if (expiresAt > now) {
                    this._cooldowns.set(userId, expiresAt);
                }
            }
        } catch {
            // Plik nie istnieje — zaczynamy od zera
        }
    }

    async save() {
        const data = {};
        const now = Date.now();
        for (const [userId, expiresAt] of this._cooldowns) {
            if (expiresAt > now) data[userId] = expiresAt;
        }
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, JSON.stringify(data, null, 2), 'utf8');
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
        this._cooldowns.set(userId, Date.now() + COOLDOWN_MS);
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

module.exports = { UpdateCooldownService, formatCooldownTime };
